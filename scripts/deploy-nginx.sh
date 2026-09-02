#!/bin/bash
set -e
# 在 taoxie.vip 443 server 块中插入 digital-avatar 配置（幂等）
CONF=/etc/nginx/sites-available/portfolio
if grep -q "digital-avatar" $CONF; then
  echo "already configured"
  exit 0
fi
python3 - <<'PYEOF'
conf = '/etc/nginx/sites-available/portfolio'
block = '''
    # 数字分身陪伴 WebApp（后端 8090，静态子路径）
    location = /digital-avatar { return 301 /digital-avatar/; }
    location /digital-avatar/api/ {
        proxy_pass http://127.0.0.1:8090/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    location /digital-avatar/socket.io/ {
        proxy_pass http://127.0.0.1:8090/socket.io/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header X-Real-IP $remote_addr;
        proxy_buffering off;
    }
    location /digital-avatar/ {
        alias /home/ubuntu/digital-avatar/client/dist/;
        try_files $uri $uri/ /digital-avatar/index.html;
    }
'''
# 插入到第一个 location = /atoms-native 之前
src = open(conf).read()
anchor = 'location = /atoms-native'
idx = src.index(anchor)
open(conf, 'w').write(src[:idx] + block.strip() + '\n\n' + src[idx:])
print('inserted')
PYEOF
nginx -t && systemctl reload nginx
echo "nginx reloaded"
curl -s -o /dev/null -w "static:%{http_code} " http://localhost/digital-avatar/
curl -s http://localhost/digital-avatar/api/health
