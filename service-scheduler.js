const { exec } = require('child_process');
const { promisify } = require('util');
const execPromise = promisify(exec);
const { getCurrentDate, getCurrentTimestamp } = require('./config');

class ServiceScheduler {
    constructor(streamManager, fileTransferManager) {
        this.streamManager = streamManager;
        this.fileTransferManager = fileTransferManager;
        this.scheduledTimers = new Map();
        this.ws = null;
    }

    setWebSocket(ws) {
        this.ws = ws;
        this.streamManager.setWebSocket(ws);
        if (this.fileTransferManager) {
            this.fileTransferManager.setWebSocket(ws);
        }
    }

    // Выполнение команд сервиса
    async runServiceCommands(serviceName, serviceConfig) {
        const streamId = `scheduled_${serviceName.replace(/[^a-zA-Z0-9]/g, '_')}`;
        const startTime = new Date();
        const rewrite = serviceConfig.rewrite === true;
        
        console.log(`⏰ [${serviceName}] Запуск задания (rewrite=${rewrite})`);
        
        if (this.ws && this.ws.readyState === 1) {
            this.ws.send(JSON.stringify({
                type: 'stream_started',
                streamId,
                streamType: 'scheduled_task',
                metadata: { 
                    service: serviceName,
                    rewrite: rewrite
                }
            }));
            
            if (rewrite) {
                this.ws.send(JSON.stringify({
                    type: 'stream_control',
                    action: 'rewrite',
                    streamId
                }));
            }
            
            // Отправляем заголовок (сервер добавит его в файл)
            this.ws.send(JSON.stringify({
                type: 'stream_data',
                streamId,
                data: `=== Service "${serviceName}" started at ${getCurrentTimestamp()} ===`
            }));
        }
        
        // Выполнение команд
        for (let i = 0; i < serviceConfig.commands.length; i++) {
            const cmd = serviceConfig.commands[i];
            const cmdStart = new Date();
            
            if (this.ws && this.ws.readyState === 1) {
                this.ws.send(JSON.stringify({
                    type: 'stream_data',
                    streamId,
                    data: `> ${cmd}`
                }));
            }
            
            try {
                const { stdout, stderr } = await execPromise(cmd, { 
                    timeout: serviceConfig.timeout || 30000,
                    maxBuffer: 1024 * 1024 * 10,
                    shell: '/bin/bash'
                });
                
                // Отправляем stdout БЕЗ добавления timestamp
                if (stdout && this.ws && this.ws.readyState === 1) {
                    const lines = stdout.trim().split('\n');
                    for (const line of lines) {
                        if (line) {
                            this.ws.send(JSON.stringify({
                                type: 'stream_data',
                                streamId,
                                data: line
                            }));
                        }
                    }
                }
                
                // Отправляем stderr если есть
                if (stderr && this.ws && this.ws.readyState === 1) {
                    this.ws.send(JSON.stringify({
                        type: 'stream_data',
                        streamId,
                        data: `[STDERR] ${stderr.trim()}`
                    }));
                }
                
            } catch (e) {
                const errorMsg = `Command failed: ${e.message}`;
                console.error(`[${serviceName}] ${errorMsg}`);
                if (this.ws && this.ws.readyState === 1) {
                    this.ws.send(JSON.stringify({
                        type: 'stream_data',
                        streamId,
                        data: `[ERROR] ${errorMsg}`
                    }));
                }
            }
            
            const cmdDuration = new Date() - cmdStart;
            if (this.ws && this.ws.readyState === 1) {
                this.ws.send(JSON.stringify({
                    type: 'stream_data',
                    streamId,
                    data: `Command completed in ${cmdDuration}ms`
                }));
            }
        }
        
        const duration = new Date() - startTime;
        
        if (this.ws && this.ws.readyState === 1) {
            this.ws.send(JSON.stringify({
                type: 'stream_data',
                streamId,
                data: `=== Service "${serviceName}" completed at ${getCurrentTimestamp()} (duration: ${duration}ms) ===`
            }));
            this.ws.send(JSON.stringify({
                type: 'stream_stopped',
                streamId,
                reason: 'Task completed'
            }));
        }
    }

    // Выполнение передачи файлов
    async runFileTransfer(serviceName, serviceConfig) {
        if (!serviceConfig.file_transfer) return;
        
        const streamId = `${serviceName.replace(/[^a-zA-Z0-9]/g, '_')}`;
        const { file_pattern, date = null } = serviceConfig.file_transfer;
        
        console.log(`📁 [${serviceName}] Запуск передачи файлов: ${file_pattern} (date=${date || 'none'})`);
        
        if (this.ws && this.ws.readyState === 1) {
            this.ws.send(JSON.stringify({
                type: 'stream_started',
                streamId,
                streamType: 'file_transfer',
                metadata: { 
                    service: serviceName,
                    file_pattern,
                    date,
                    rewrite: serviceConfig.rewrite === true
                }
            }));
            
            await this.fileTransferManager.sendFiles(streamId, file_pattern, date);
            
            this.ws.send(JSON.stringify({
                type: 'stream_stopped',
                streamId,
                reason: 'File transfer completed'
            }));
        }
    }

    // Парсер cron форматов
    parseSimpleCron(cronStr) {
        const now = new Date();
        
        const minutesMatch = cronStr.match(/^\*\/(\d+)\s+\*\s+\*\s+\*\s+\*$/);
        if (minutesMatch) {
            const interval = parseInt(minutesMatch[1]);
            const next = new Date(now);
            const currentMinutes = now.getMinutes();
            const minutesToAdd = interval - (currentMinutes % interval);
            next.setMinutes(currentMinutes + minutesToAdd, 0, 0);
            return next;
        }
        
        const hoursMatch = cronStr.match(/^(\d+)\s+\*\/(\d+)\s+\*\s+\*\s+\*$/);
        if (hoursMatch) {
            const minute = parseInt(hoursMatch[1]);
            const interval = parseInt(hoursMatch[2]);
            const next = new Date(now);
            const currentHour = now.getHours();
            const hoursToAdd = interval - (currentHour % interval);
            
            if (hoursToAdd === interval && now.getMinutes() < minute) {
                next.setHours(currentHour, minute, 0, 0);
            } else {
                next.setHours(currentHour + hoursToAdd, minute, 0, 0);
            }
            return next;
        }
        
        return null;
    }

    // Планирование сервиса
    scheduleService(serviceName, serviceConfig) {
        if (!serviceConfig.schedule) return;
        
        const scheduleStr = serviceConfig.schedule;
        let nextRun;
        
        try {
            if (/^\d{2}:\d{2}$/.test(scheduleStr)) {
                const [hours, minutes] = scheduleStr.split(':').map(Number);
                const now = new Date();
                nextRun = new Date(now);
                nextRun.setHours(hours, minutes, 0, 0);
                
                if (nextRun <= now) {
                    nextRun.setDate(nextRun.getDate() + 1);
                }
            } else {
                nextRun = this.parseSimpleCron(scheduleStr);
                if (!nextRun) {
                    console.error(`❌ [${serviceName}] Неподдерживаемый формат расписания: "${scheduleStr}"`);
                    return;
                }
            }
        } catch (e) {
            console.error(`❌ [${serviceName}] Ошибка парсинга расписания "${scheduleStr}":`, e.message);
            return;
        }
        
        const delay = nextRun - new Date();
        console.log(`📅 [${serviceName}] Запланировано на ${nextRun.toISOString()} (через ${Math.round(delay/1000)} сек)`);
        
        const timer = setTimeout(async () => {
            // Выполняем команды если есть
            if (serviceConfig.commands && serviceConfig.commands.length > 0) {
                await this.runServiceCommands(serviceName, serviceConfig);
            }
            
            // Выполняем передачу файлов если настроена
            if (serviceConfig.file_transfer) {
                await this.runFileTransfer(serviceName, serviceConfig);
            }
            
            this.scheduledTimers.delete(serviceName);
            this.scheduleService(serviceName, serviceConfig);
        }, delay);
        
        this.scheduledTimers.set(serviceName, { timer, nextRun });
    }

    // Запуск всех сервисов
    async startAllServices(servicesConfig) {
        console.log('\n📋 Запуск сервисов из конфига...');
        
        const immediateTasks = [];
        
        for (const [serviceName, serviceConfig] of Object.entries(servicesConfig)) {
            if (!serviceConfig.enabled) {
                console.log(`⏭️  [${serviceName}] Отключен, пропускаем`);
                continue;
            }
            
            console.log(`✅ [${serviceName}] Включен`);
            
            // Tail-потоки (только для сервисов с tail)
            if (serviceConfig.tail && typeof serviceConfig.tail === 'object') {
                const tailConfig = serviceConfig.tail;
                const rewrite = serviceConfig.rewrite === true;
                const tailLines = serviceConfig.tail_lines !== undefined 
                    ? serviceConfig.tail_lines 
                    : (rewrite ? 100 : 0);
                
                console.log(`  📊 [${serviceName}] tail_lines=${tailLines}, rewrite=${rewrite}`);
                
                for (const [logType, filePath] of Object.entries(tailConfig)) {
                    if (typeof filePath !== 'string' || !filePath) {
                        console.log(`⚠️  [${serviceName}] Пропущен ${logType}: некорректный путь`);
                        continue;
                    }
                    
                    const streamId = `${serviceName}_${logType}`;
                    console.log(`  🔍 [${serviceName}] Запуск tail для ${logType} (tail_lines=${tailLines})`);
                    
                    const process = await this.streamManager.startTailStream(streamId, filePath, serviceName, rewrite, tailLines);
                    
                    if (process) {
                        this.streamManager.getActiveStreams().set(streamId, {
                            type: 'tail',
                            process,
                            metadata: { service: serviceName, logType, filePath, rewrite, tailLines }
                        });
                        
                        if (this.ws && this.ws.readyState === 1) {
                            this.ws.send(JSON.stringify({
                                type: 'stream_started',
                                streamId,
                                streamType: 'tail',
                                metadata: { 
                                    service: serviceName, 
                                    logType, 
                                    filePath, 
                                    rewrite,
                                    tailLines 
                                }
                            }));
                        }
                    } else {
                        console.error(`❌ [${serviceName}] Не удалось запустить tail для ${logType}`);
                    }
                }
            }
            
            // Задачи по расписанию (команды или передача файлов)
            const hasCommands = serviceConfig.commands && Array.isArray(serviceConfig.commands) && serviceConfig.commands.length > 0;
            const hasFileTransfer = serviceConfig.file_transfer && serviceConfig.file_transfer.file_pattern;
            
            if ((hasCommands || hasFileTransfer) && serviceConfig.schedule) {
                immediateTasks.push({ serviceName, serviceConfig });
            } else if (hasCommands && !serviceConfig.schedule) {
                console.log(`⚠️  [${serviceName}] Есть команды, но нет расписания — пропущено`);
            } else if (hasFileTransfer && !serviceConfig.schedule) {
                console.log(`⚠️  [${serviceName}] Есть передача файлов, но нет расписания — пропущено`);
            }
        }
        
        // Выполняем немедленно
        if (immediateTasks.length > 0) {
            console.log(`\n🚀 Немедленный запуск ${immediateTasks.length} задач...`);
            for (const { serviceName, serviceConfig } of immediateTasks) {
                if (serviceConfig.commands && serviceConfig.commands.length > 0) {
                    await this.runServiceCommands(serviceName, serviceConfig);
                }
                if (serviceConfig.file_transfer) {
                    await this.runFileTransfer(serviceName, serviceConfig);
                }
            }
            console.log('✅ Все задачи первого запуска выполнены\n');
        }
        
        // Планируем на будущее
        for (const { serviceName, serviceConfig } of immediateTasks) {
            this.scheduleService(serviceName, serviceConfig);
        }
        
        console.log('📋 Запуск сервисов завершен\n');
    }

    // Остановка всех сервисов
    stopAllServices() {
        for (const [serviceName, info] of this.scheduledTimers) {
            clearTimeout(info.timer);
            console.log(`🛑 [${serviceName}] Таймер остановлен`);
        }
        this.scheduledTimers.clear();
        this.streamManager.stopAllStreams();
        if (this.fileTransferManager) {
            this.fileTransferManager.stopAllTransfers();
        }
    }

    reloadServicesConfig(servicesConfig) {
        this.stopAllServices();
        this.startAllServices(servicesConfig);
    }
}

module.exports = ServiceScheduler;