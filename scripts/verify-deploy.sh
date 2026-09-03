#!/bin/bash
# V1.1.0 部署验证：IPv4 HTTPS 静态资源 + API + WebSocket
B="https://taoxie.vip/digital-avatar"
R="--resolve taoxie.vip:443:127.0.0.1"
echo "== static =="
curl -sk $R -o /tmp/da_index.html -w "index: %{http_code}\n" $B/
ASSET=$(grep -oE 'assets/[a-zA-Z0-9._-]+\.js' /tmp/da_index.html | head -1)
echo "asset: $ASSET"
curl -sk $R -o /tmp/da_asset.js -w "asset: %{http_code} size: %{size_download}\n" "$B/$ASSET"
echo "== api =="
curl -sk $R -o /tmp/da_health.json -w "health: %{http_code}\n" "$B/api/health"
cat /tmp/da_health.json; echo
echo "== socket.io =="
curl -sk $R -o /tmp/da_sio.txt -w "sio: %{http_code}\n" "$B/socket.io/?EIO=4&transport=polling"
head -c 80 /tmp/da_sio.txt; echo
echo "== dist version =="
ls /home/ubuntu/digital-avatar/client/dist/ | head -5
grep -oE 'assets/index-[a-zA-Z0-9._-]+\.js' /home/ubuntu/digital-avatar/client/dist/index.html | head -1
