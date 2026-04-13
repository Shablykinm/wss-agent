// stream-manager.js

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const readline = require('readline');

class StreamManager {
    constructor() {
        this.activeStreams = new Map();
        this.ws = null;
    }

    setWebSocket(ws) {
        this.ws = ws;
    }

    // Чтение последних N строк файла асинхронно
    async readLastLines(filePath, linesCount) {
        return new Promise((resolve) => {
            const allLines = [];
            
            const rl = readline.createInterface({
                input: fs.createReadStream(filePath),
                output: null,
                terminal: false
            });
            
            rl.on('line', (line) => {
                allLines.push(line);
            });
            
            rl.on('close', () => {
                const start = Math.max(0, allLines.length - linesCount);
                const lastLines = allLines.slice(start);
                resolve(lastLines);
            });
            
            rl.on('error', (err) => {
                console.error(`[readLastLines] Ошибка чтения ${filePath}:`, err.message);
                resolve([]);
            });
        });
    }

    async startTailStream(streamId, filePath, serviceName, rewrite = false, tailLines = 100) {
        // Проверяем существование файла (tail -F будет ждать, если файла нет, но для истории нужен существующий файл)
        const fileExists = fs.existsSync(filePath);
        if (!fileExists) {
            console.log(`⚠️  [${serviceName}] Файл ${filePath} не существует, tail -F будет ожидать его появления`);
            // Не отправляем ошибку, так как tail -F сам справится, но историю отправить не сможем
        } else {
            // Проверяем права на чтение
            try {
                fs.accessSync(filePath, fs.constants.R_OK);
            } catch (e) {
                console.log(`⚠️  [${serviceName}] Нет прав на чтение ${filePath}`);
                if (this.ws && this.ws.readyState === 1) {
                    this.ws.send(JSON.stringify({
                        type: 'stream_error',
                        streamId,
                        error: `Permission denied: ${filePath}`
                    }));
                }
                return null;
            }
        }
        
        console.log(`📄 [${serviceName}] Запуск tail -F: ${filePath} (rewrite=${rewrite}, tailLines=${tailLines})`);
        
        // Извлекаем logType из streamId
        const logType = streamId.replace(`${serviceName}_`, '');
        
        // 1. Сначала отправляем stream_started, чтобы сервер создал поток
        if (this.ws && this.ws.readyState === 1) {
            this.ws.send(JSON.stringify({
                type: 'stream_started',
                streamId,
                streamType: 'tail',
                metadata: { 
                    service: serviceName, 
                    logType: logType,
                    filePath: filePath, 
                    rewrite: rewrite,
                    tailLines: tailLines 
                }
            }));
            
            // Небольшая задержка, чтобы сервер успел создать поток
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        // 2. Отправляем историю если tailLines > 0 и файл существует
        if (tailLines > 0 && fileExists && this.ws && this.ws.readyState === 1) {
            try {
                console.log(`📖 [${serviceName}] Чтение последних ${tailLines} строк из ${filePath}`);
                const lastLines = await this.readLastLines(filePath, tailLines);
                console.log(`📜 [${serviceName}] Прочитано ${lastLines.length} строк для ${streamId}`);
                
                if (lastLines.length > 0) {
                    for (const line of lastLines) {
                        if (line && line.trim()) {
                            this.ws.send(JSON.stringify({
                                type: 'stream_data',
                                streamId,
                                data: line
                            }));
                        }
                    }
                    console.log(`✅ [${serviceName}] Отправлено ${lastLines.length} строк истории`);
                } else {
                    console.log(`⚠️ [${serviceName}] Файл пуст или не удалось прочитать строки`);
                }
            } catch (e) {
                console.error(`❌ [${serviceName}] Ошибка чтения истории:`, e.message);
                this.ws.send(JSON.stringify({
                    type: 'stream_error',
                    streamId,
                    error: `Failed to read history: ${e.message}`
                }));
            }
        }
        
        // 3. Запускаем tail -F (следит по имени, переоткрывает при ротации)
        // Используем -n 0, чтобы не выводить последние 10 строк по умолчанию (мы уже отправили историю)
        const tailProcess = spawn('tail', ['-n', '0', '-F', filePath]);
        
        tailProcess.stdout.on('data', (data) => {
            if (this.ws && this.ws.readyState === 1) {
                const lines = data.toString().split('\n');
                for (const line of lines) {
                    if (line && line.trim()) {
                        this.ws.send(JSON.stringify({
                            type: 'stream_data',
                            streamId,
                            data: line
                        }));
                    }
                }
            }
        });
        
        tailProcess.stderr.on('data', (data) => {
            console.error(`[${streamId}] stderr: ${data}`);
            if (this.ws && this.ws.readyState === 1) {
                this.ws.send(JSON.stringify({
                    type: 'stream_error',
                    streamId,
                    error: data.toString()
                }));
            }
        });
        
        tailProcess.on('close', (code) => {
            console.log(`[${streamId}] tail процесс завершился с кодом ${code}`);
            this.activeStreams.delete(streamId);
            if (this.ws && this.ws.readyState === 1) {
                this.ws.send(JSON.stringify({
                    type: 'stream_stopped',
                    streamId,
                    reason: `Process exited with code ${code}`
                }));
            }
            // При необходимости здесь можно добавить логику перезапуска tail,
            // но tail -F сам должен переживать временные проблемы.
            // Если процесс умер из-за фатальной ошибки, можно запланировать перезапуск,
            // но в рамках текущей архитектуры переподключение происходит при реконнекте агента.
        });
        
        tailProcess.on('error', (err) => {
            console.error(`[${streamId}] Ошибка процесса:`, err);
            if (this.ws && this.ws.readyState === 1) {
                this.ws.send(JSON.stringify({
                    type: 'stream_error',
                    streamId,
                    error: err.message
                }));
            }
        });
        
        return tailProcess;
    }

    stopAllStreams() {
        for (const [streamId, streamInfo] of this.activeStreams) {
            if (streamInfo.process) {
                streamInfo.process.kill('SIGTERM');
            }
            console.log(`🛑 Поток ${streamId} остановлен`);
        }
        this.activeStreams.clear();
    }

    getActiveStreams() {
        return this.activeStreams;
    }
}

module.exports = StreamManager;