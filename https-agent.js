const fs = require('fs');
const https = require('https');

function createHttpsAgent(serverCertFile) {
    try {
        const serverCert = fs.readFileSync(serverCertFile);
        return new https.Agent({
            ca: serverCert,
            rejectUnauthorized: false,
            keepAlive: true
        });
    } catch (err) {
        console.error('❌ Ошибка загрузки сертификата сервера:', err.message);
        process.exit(1);
    }
}

module.exports = { createHttpsAgent };