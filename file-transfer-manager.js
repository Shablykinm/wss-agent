const fs = require('fs');
const path = require('path');
const { glob } = require('glob');
const { getCurrentDate, getYesterdayDate } = require('./config');

class FileTransferManager {
    constructor() {
        this.ws = null;
        this.activeTransfers = new Map();
    }

    setWebSocket(ws) {
        this.ws = ws;
    }

    // Замена плейсхолдеров даты в маске
    replaceDatePlaceholders(filePattern, dateValue) {
        return filePattern.replace(/\{date\}/g, dateValue);
    }

    // Получение даты в зависимости от параметра
    getDateString(dateParam) {
        if (dateParam === 'today') {
            return getCurrentDate();
        } else if (dateParam === 'yesterday') {
            return getYesterdayDate();
        }
        return dateParam;
    }

    // Поиск файлов по маске с учетом даты
    async findFiles(filePattern, dateParam = null) {
        try {
            let pattern = filePattern;
            
            if (dateParam) {
                const dateString = this.getDateString(dateParam);
                pattern = this.replaceDatePlaceholders(filePattern, dateString);
                console.log(`[FileTransfer] Маска с датой: ${pattern}`);
            }
            
            const files = await glob(pattern, { nodir: true });
            return files.sort((a, b) => {
                return fs.statSync(b).mtime - fs.statSync(a).mtime;
            });
        } catch (err) {
            console.error(`Ошибка поиска файлов по маске ${filePattern}:`, err);
            return [];
        }
    }

    // Чтение содержимого файла
    readFileContent(filePath, maxSize = 10 * 1024 * 1024) {
        try {
            const stats = fs.statSync(filePath);
            if (stats.size > maxSize) {
                return { error: `File too large: ${stats.size} bytes (max ${maxSize})` };
            }
            
            const content = fs.readFileSync(filePath, 'utf8');
            return { content, size: stats.size, mtime: stats.mtime };
        } catch (err) {
            return { error: err.message };
        }
    }

    // Отправка файлов на сервер
    async sendFiles(streamId, filePattern, dateParam = null) {
        if (!this.ws || this.ws.readyState !== 1) {
            console.error(`[FileTransfer] WebSocket не подключен`);
            return false;
        }

        const transferId = `transfer_${Date.now()}`;
        
        console.log(`[FileTransfer] Поиск файлов по маске: ${filePattern} (date=${dateParam || 'none'})`);
        const files = await this.findFiles(filePattern, dateParam);
        
        if (files.length === 0) {
            console.log(`[FileTransfer] Файлы не найдены: ${filePattern}`);
            this.ws.send(JSON.stringify({
                type: 'stream_error',
                streamId,
                error: `No files found matching pattern: ${filePattern}`
            }));
            return false;
        }

        console.log(`[FileTransfer] Найдено файлов: ${files.length}`);
        
        // Отправляем все найденные файлы
        for (let i = 0; i < files.length; i++) {
            const filePath = files[i];
            const fileName = path.basename(filePath);
            console.log(`[FileTransfer] Чтение файла: ${filePath}`);
            
            const { content, error, size, mtime } = this.readFileContent(filePath);
            
            if (error) {
                console.error(`[FileTransfer] Ошибка чтения ${filePath}: ${error}`);
                this.ws.send(JSON.stringify({
                    type: 'stream_error',
                    streamId,
                    error: `Failed to read ${fileName}: ${error}`
                }));
                continue;
            }

            // Отправляем данные файла
            this.ws.send(JSON.stringify({
                type: 'file_transfer_data',
                transferId,
                streamId,
                fileName,
                originalPath: filePath,
                content,
                size,
                mtime: mtime.toISOString(),
                isLast: i === files.length - 1
            }));

            console.log(`[FileTransfer] Отправлен файл ${fileName} (${size} bytes)`);
        }

        return true;
    }

    // Остановка активных передач
    stopAllTransfers() {
        this.activeTransfers.clear();
        console.log(`[FileTransfer] Все передачи остановлены`);
    }
}

module.exports = FileTransferManager;