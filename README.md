# WSS Agent

## Зачем?
Затем

## Запуск
Клонируем в /opt/wss-agent

или запускаем
sh copyToOPT.sh 
если склонировали в другое место

# Копируйте systemd unit файл
sudo cp wss-agent.service /etc/systemd/system/

# Перезагрузите systemd
sudo systemctl daemon-reload

# Включите автозапуск
sudo systemctl enable wss-agent

# Запустите сервис
sudo systemctl start wss-agent

# Проверьте статус
sudo systemctl status wss-agent