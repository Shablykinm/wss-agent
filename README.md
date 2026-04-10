# WSS Agent

## Зачем?
Затем

## Запуск
Клонируем в /opt/wss-agent
```
cd /opt
git clone https://github.com/Shablykinm/wss-agent.git
```
Если уже склонировали в другое место или из папки с проекта запускаем
```
sh copyToOPT.sh 
```

Копируем сертификаты, полученные при инициализации wss-server

заупускаем процедуру инициализации
```
sh ./init-agent.sh
```
Вводем ip адрес сервера, копируем токен регистрации registration.master.token полученный при инициализации wss-server


Для проверки работы запускаем 
```
npm i
node agent.js
```

Если забыли про .env
```
SERVER_URL=wss://ip адрес сервера:8443/ws
API_URL=https://ip адрес сервера:8443/api
SERVER_CERT_FILE=./certs/server-cert.pem
PRIVATE_KEY_FILE=./certs/id_ed25519.pem
PUBLIC_KEY_FILE=./certs/id_ed25519.pub.pem
CONFIG_FILE=./data/agent-config.json
REGISTRATION_TOKEN_FILE=./data/registration.token
RECONNECT_DELAY=5000
COMMAND_TIMEOUT=30000
MONITOR_INTERVAL=300000
TIMEZONE=Europe/Moscow
```



# Копируйте systemd unit файл
```
sudo cp wss-agent.service /etc/systemd/system/
```
# Перезагрузите systemd
```
sudo systemctl daemon-reload
```
# Включите автозапуск
```
sudo systemctl enable wss-agent
```
# Запустите сервис
```
sudo systemctl start wss-agent
```
# Проверьте статус
```
sudo systemctl status wss-agent
```