const WebSocket = require('ws');
const { signChallenge } = require('./crypto-utils');

class WebSocketClient {
    constructor(config, httpsAgent, serviceScheduler, commandHandler) {
        this.config = config;
        this.httpsAgent = httpsAgent;
        this.serviceScheduler = serviceScheduler;
        this.commandHandler = commandHandler;
        this.ws = null;
        this.reconnectTimer = null;
        this.onAuthSuccess = null;
    }

    setAuthSuccessCallback(callback) {
        this.onAuthSuccess = callback;
    }

    async connect(registerFn) {
        const agentConfig = this.config.getAgentConfig();
        
        if (!agentConfig.registered) {
            console.log('🔐 Агент не зарегистрирован, выполняем регистрацию...');
            const registered = await registerFn();
            if (!registered) {
                console.log(`⚠️  Регистрация не удалась, повтор через ${this.config.RECONNECT_DELAY/1000} сек...`);
                setTimeout(() => this.connect(registerFn), this.config.RECONNECT_DELAY);
                return;
            }
        }
        
        const wsUrl = `wss://${this.config.SERVER_IP}:8443/ws`;
        console.log(`🔌 Подключение к ${wsUrl}...`);
        
        try {
            this.ws = new WebSocket(wsUrl, { 
                agent: this.httpsAgent,
                rejectUnauthorized: false
            });
            
            // Устанавливаем WebSocket для всех зависимостей
            this.serviceScheduler.setWebSocket(this.ws);
            this.commandHandler.setWebSocket(this.ws);
            
            this.ws.on('open', () => {
                console.log('📡 WebSocket соединение установлено, ожидание challenge...');
            });
            
            this.ws.on('message', async (data) => {
                try {
                    const msg = JSON.parse(data);
                    
                    switch (msg.type) {
                        case 'challenge':
                            const signature = signChallenge(msg.challenge, this.config.privateKeyPem);
                            this.ws.send(JSON.stringify({
                                type: 'auth_response',
                                serverId: this.config.SERVER_ID,
                                signature
                            }));
                            console.log('🔐 Отправлен ответ на challenge');
                            break;
                            
                        case 'auth_ok':
                            console.log('✅ Аутентификация успешна! Агент онлайн.');
                            if (!agentConfig.registered) {
                                this.config.setAgentRegistered(true);
                            }
                            if (this.onAuthSuccess) {
                                await this.onAuthSuccess();
                            }
                            break;
                            
                        case 'auth_failed':
                            console.error('❌ Аутентификация отклонена сервером');
                            this.config.setAgentRegistered(false);
                            this.ws.close();
                            break;
                            
                        case 'cmd':
                            console.log(`📥 Получена команда: ${msg.command} ${msg.args ? msg.args.join(' ') : ''}`);
                            await this.commandHandler.handleCommand(msg);
                            break;
                            
                        default:
                            console.log(`📨 Неизвестный тип сообщения: ${msg.type}`);
                    }
                } catch (e) {
                    console.error('❌ Ошибка обработки сообщения:', e.message);
                }
            });
            
            this.ws.on('close', (code, reason) => {
                console.log(`🔌 Соединение закрыто: код=${code}, причина=${reason || 'нет'}`);
                this.ws = null;
                this.serviceScheduler.stopAllServices();
                
                if (code !== 1008) {
                    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
                    this.reconnectTimer = setTimeout(() => this.connect(registerFn), this.config.RECONNECT_DELAY);
                } else {
                    console.log('🔄 Ошибка аутентификации, пробуем перерегистрироваться...');
                    this.config.setAgentRegistered(false);
                    this.reconnectTimer = setTimeout(() => this.connect(registerFn), this.config.RECONNECT_DELAY);
                }
            });
            
            this.ws.on('error', (err) => {
                console.error('❌ WebSocket ошибка:', err.message);
            });
        } catch (err) {
            console.error('❌ Ошибка подключения:', err.message);
            this.reconnectTimer = setTimeout(() => this.connect(registerFn), this.config.RECONNECT_DELAY);
        }
    }

    close() {
        if (this.ws) {
            this.ws.close();
        }
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
        }
    }

    getWebSocket() {
        return this.ws;
    }
}

module.exports = WebSocketClient;