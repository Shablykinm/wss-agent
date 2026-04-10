#!/bin/bash

#pushim
git add .
git commit -m "new fix and new bugs :D"
git push

#copy service
sudo cp wss-agent.service /etc/systemd/system/

#copy to /opt/wss-agent
cd ../
sudo cp wss-agent /opt/wss-agent -r

#reload and restart agent
sudo systemctl daemon-reload && systemctl restart wss-agent
