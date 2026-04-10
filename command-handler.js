const { exec } = require('child_process');
const { promisify } = require('util');
const execPromise = promisify(exec);
const fs = require('fs');

class CommandHandler {
    constructor(config, serviceScheduler) {
        this.config = config;
        this.serviceScheduler = serviceScheduler;
        this.ws = null;
    }

    setWebSocket(ws) {
        this.ws = ws;
    }

    async handleCommand(cmdMsg) {
        const { requestId, command, args } = cmdMsg;
        let result = '';
        let error = null;
        
        try {
            switch (command) {
                case 'exec':
                    const cmd = args.join(' ');
                    console.log(`🖥️  Выполнение: ${cmd}`);
                    const { stdout, stderr } = await execPromise(cmd, { 
                        timeout: 30000,
                        maxBuffer: 1024 * 1024 * 10
                    });
                    result = stdout;
                    if (stderr) error = stderr;
                    break;
                    
                case 'smartctl':
                    const device = args[0] || '/dev/sda';
                    console.log(`💾 Чтение SMART данных с ${device}`);
                    const { stdout: smartOut } = await execPromise(`smartctl -a ${device} 2>/dev/null || echo "smartctl not found"`);
                    result = smartOut;
                    break;
                    
                case 'tail_log':
                    const lines = args[0] || 100;
                    const logFile = args[1] || '/var/log/syslog';
                    console.log(`📄 Чтение ${lines} строк из ${logFile}`);
                    const { stdout: tailOut } = await execPromise(`tail -n ${lines} ${logFile} 2>/dev/null || echo "Log file not accessible"`);
                    result = tailOut;
                    break;
                    
                case 'reload_services':
                    if (fs.existsSync(this.config.SERVICES_CONFIG_FILE)) {
                        const newConfig = JSON.parse(fs.readFileSync(this.config.SERVICES_CONFIG_FILE, 'utf8'));
                        this.config.setServicesConfig(newConfig);
                        this.serviceScheduler.reloadServicesConfig(newConfig);
                        result = 'Services reloaded';
                    } else {
                        error = 'Services config not found';
                    }
                    break;
                    
                case 'list_services':
                    const servicesConfig = this.config.getServicesConfig();
                    const services = Object.entries(servicesConfig).map(([name, cfg]) => ({
                        name,
                        enabled: cfg.enabled,
                        schedule: cfg.schedule,
                        hasTail: !!cfg.tail,
                        commandsCount: cfg.commands?.length || 0
                    }));
                    result = JSON.stringify(services, null, 2);
                    break;
                    
                default:
                    error = `Unknown command: ${command}`;
            }
        } catch (e) {
            error = e.message;
            console.error(`❌ Ошибка выполнения команды ${command}:`, error);
        }
        
        if (this.ws && this.ws.readyState === 1) {
            this.ws.send(JSON.stringify({
                type: 'cmd_response',
                requestId,
                result,
                error
            }));
            console.log(`📤 Отправлен ответ на команду ${requestId}`);
        }
    }
}

module.exports = CommandHandler;