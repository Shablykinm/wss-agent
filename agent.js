const config = require('./config');
const { createHttpsAgent } = require('./https-agent');
const StreamManager = require('./stream-manager');
const FileTransferManager = require('./file-transfer-manager');
const ServiceScheduler = require('./service-scheduler');
const CommandHandler = require('./command-handler');
const WebSocketClient = require('./websocket-client');
const { registerAgent } = require('./registration');

// ================== Инициализация компонентов ==================
const httpsAgent = createHttpsAgent(config.SERVER_CERT_FILE);
const streamManager = new StreamManager();
const fileTransferManager = new FileTransferManager();
const serviceScheduler = new ServiceScheduler(streamManager, fileTransferManager);
const commandHandler = new CommandHandler(config, serviceScheduler);
const wsClient = new WebSocketClient(config, httpsAgent, serviceScheduler, commandHandler);

// Устанавливаем callback для запуска сервисов после успешной аутентификации
wsClient.setAuthSuccessCallback(async () => {
    const servicesConfig = config.getServicesConfig();
    await serviceScheduler.startAllServices(servicesConfig);
});

// ================== Обработка сигналов ==================
process.on('SIGINT', () => {
    console.log('\n👋 Получен сигнал завершения...');
    serviceScheduler.stopAllServices();
    wsClient.close();
    setTimeout(() => process.exit(0), 1000);
});

process.on('SIGTERM', () => {
    console.log('\n👋 Получен сигнал SIGTERM...');
    serviceScheduler.stopAllServices();
    wsClient.close();
    setTimeout(() => process.exit(0), 1000);
});

// ================== Запуск ==================
console.log('='.repeat(60));
console.log(`🚀 Запуск агента: ${config.SERVER_ID}`);
console.log(`📁 Конфиг: ${config.CONFIG_FILE}`);
console.log(`📁 Сервисы: ${config.SERVICES_CONFIG_FILE}`);
console.log(`🌐 Сервер: ${config.SERVER_IP}:8443`);
console.log(`🔑 Статус регистрации: ${config.getAgentConfig().registered ? '✅ зарегистрирован' : '❌ не зарегистрирован'}`);
console.log(`🕐 Часовой пояс: ${config.TIMEZONE}`);
console.log('='.repeat(60));
console.log('');

// Запускаем соединение
wsClient.connect(() => registerAgent(config, httpsAgent));