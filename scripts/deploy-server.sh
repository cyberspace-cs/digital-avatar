#!/bin/bash
set -e
export PATH=/home/ubuntu/node22/bin:$PATH
cd /home/ubuntu/digital-avatar/server
npm install --omit=dev --loglevel=error
# 用 tmux 跑，方便后续重启
tmux kill-session -t davatar 2>/dev/null || true
tmux new-session -d -s davatar "cd /home/ubuntu/digital-avatar/server && PORT=8090 PATH=/home/ubuntu/node22/bin:$PATH node src/index.js > /home/ubuntu/digital-avatar/server.log 2>&1"
sleep 2
echo "HEALTH: $(curl -s http://localhost:8090/api/health)"
tail -n 3 /home/ubuntu/digital-avatar/server.log
