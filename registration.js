const https = require('https');

async function registerAgent(config, httpsAgent) {
    if (!config.REGISTRATION_TOKEN) {
        console.error('❌ Токен регистрации не найден!');
        return false;
    }
    
    console.log('📝 Отправка запроса на регистрацию...');
    
    return new Promise((resolve) => {
        const postData = JSON.stringify({
            serverId: config.SERVER_ID,
            publicKey: config.publicKeyBase64,
            registrationToken: config.REGISTRATION_TOKEN
        });
        
        const options = {
            hostname: config.SERVER_IP,
            port: 8443,
            path: '/api/register',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            },
            agent: httpsAgent
        };
        
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode === 200) {
                    console.log('✅ Агент успешно зарегистрирован на сервере');
                    config.setAgentRegistered(true);
                    resolve(true);
                } else {
                    console.error(`❌ Ошибка регистрации: ${res.statusCode}`);
                    if (data) console.error(`   Ответ: ${data}`);
                    resolve(false);
                }
            });
        });
        
        req.on('error', (err) => {
            console.error('❌ Ошибка соединения при регистрации:', err.message);
            resolve(false);
        });
        
        req.write(postData);
        req.end();
    });
}

module.exports = { registerAgent };