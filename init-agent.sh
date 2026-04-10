#!/bin/bash

# Создание структуры папок
mkdir -p certs data logs

# Проверка наличия файлов сертификата сервера
if [ ! -f "certs/server-cert.pem" ]; then
    echo "❌ Файл сертификата сервера не найден!"
    echo "Пожалуйста, скопируйте папку certs/ с сервера в текущую директорию"
    exit 1
fi

# Запрос параметров у пользователя
read -p "Введите адрес сервера (например, 192.168.88.13): " SERVER_IP
read -p "Введите регистрационный токен: " REG_TOKEN

# Генерация конфигурации агента
HOSTNAME=$(hostname)
RANDOM_SUFFIX=$(openssl rand -hex 4)
SERVER_ID="agent-${HOSTNAME}-${RANDOM_SUFFIX}"

# Генерация ключей Ed25519
echo "Генерация ключей Ed25519..."
node -e "
const crypto = require('crypto');
const fs = require('fs');

const keyPair = crypto.generateKeyPairSync('ed25519');
const privateKeyPem = keyPair.privateKey.export({ type: 'pkcs8', format: 'pem' });
const publicKeyPem = keyPair.publicKey.export({ type: 'spki', format: 'pem' });

fs.writeFileSync('certs/id_ed25519.pem', privateKeyPem);
fs.writeFileSync('certs/id_ed25519.pub.pem', publicKeyPem);

const publicKeyBase64 = publicKeyPem
    .replace('-----BEGIN PUBLIC KEY-----\n', '')
    .replace('\n-----END PUBLIC KEY-----', '')
    .replace(/\n/g, '');

console.log('Public key base64:', publicKeyBase64);
"

# Получаем публичный ключ
PUB_KEY=$(cat certs/id_ed25519.pub.pem | grep -v "BEGIN\|END" | tr -d '\n')

# Создаем конфиг с флагом registered=false
cat > data/agent-config.json <<EOF
{
  "serverId": "$SERVER_ID",
  "serverIp": "$SERVER_IP",
  "publicKey": "$PUB_KEY",
  "registered": false
}
EOF

# Сохраняем токен регистрации
echo "$REG_TOKEN" > data/registration.token

echo ""
echo "✅ Агент инициализирован!"
echo "📁 Структура создана:"
echo "   - certs/     - ключи агента и сертификат сервера"
echo "   - data/      - конфигурация и токен"
echo ""
echo "🆔 Server ID: $SERVER_ID"
echo "🔑 Публичный ключ: $PUB_KEY"
echo ""
echo "🚀 При первом запуске агент автоматически зарегистрируется на сервере"
echo "Для запуска агента: node agent.js"