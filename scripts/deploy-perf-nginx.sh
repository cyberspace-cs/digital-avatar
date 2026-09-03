#!/bin/bash
# 加载性能 nginx 调优（幂等）：
#  1) gzip_types 补全：nginx 默认只压 text/html，导致 JS/JSON/wasm 全量未压缩传输。
#     写入 /etc/nginx/conf.d/davatar-gzip.conf（http 上下文，覆盖全站）。
#  2) 静态资源缓存头：assets/（hash 命名，永久 immutable）、models/（7天）；
#     index.html no-cache，保证新版本能即时生效。
set -e
CONF=/etc/nginx/sites-available/portfolio

# ---- 1) gzip 配置（conf.d，http 上下文）----
# 注意：nginx.conf 的 http 块里已有 `gzip on;`，这里不能重复（会 emerg duplicate），
# 只补全 gzip_types / 级别等参数即可（conf.d 同样在 http 上下文，继承 gzip on）。
cat > /etc/nginx/conf.d/davatar-gzip.conf <<'EOF'
# digital-avatar 加载性能：对 JS/JSON/wasm/CSS/SVG 开启 gzip（图片本身已压缩，不压）
gzip_comp_level 6;
gzip_min_length 1024;
gzip_vary on;
gzip_proxied any;
gzip_types
    text/plain text/css text/xml
    application/javascript application/x-javascript
    application/json application/ld+json
    application/xml application/wasm
    application/octet-stream
    image/svg+xml;
EOF
echo "gzip conf written"

# ---- 2) 站点静态缓存 + index.html no-cache（幂等，带标记）----
if ! grep -q "digital-avatar-perf" "$CONF"; then
python3 - <<'PYEOF'
conf = '/etc/nginx/sites-available/portfolio'
src = open(conf).read()
block = '''
    # digital-avatar-perf: 静态资源缓存（assets 永久 immutable / models 7天），index.html 不缓存
    location ^~ /digital-avatar/assets/ {
        alias /home/ubuntu/digital-avatar/client/dist/assets/;
        expires 30d;
        add_header Cache-Control "public, max-age=2592000, immutable";
        try_files $uri =404;
    }
    location ^~ /digital-avatar/models/ {
        alias /home/ubuntu/digital-avatar/client/dist/models/;
        expires 7d;
        add_header Cache-Control "public, max-age=604800";
        try_files $uri =404;
    }
    location = /digital-avatar/index.html {
        alias /home/ubuntu/digital-avatar/client/dist/index.html;
        add_header Cache-Control "no-cache";
    }
'''
anchor = 'location = /atoms-native'
idx = src.index(anchor)
open(conf, 'w').write(src[:idx] + block.strip() + '\n\n' + src[idx:])
print('cache block inserted')
PYEOF
else
  echo "cache block already present"
fi

nginx -t && systemctl reload nginx
echo "nginx reloaded"
