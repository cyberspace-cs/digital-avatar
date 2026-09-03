#!/bin/bash
# 加载性能复测：对比"实际传输字节"（gzip 后 / webp）与磁盘大小
B="https://taoxie.vip/digital-avatar"
R="--resolve taoxie.vip:443:127.0.0.1"

echo "== JS bundle: gzip 生效？ =="
curl -sk $R -H "Accept-Encoding: gzip,br" -o /dev/null -D - "$B/assets/index-3POY8y4R.js" \
  | grep -iE "content-encoding|cache-control|content-type"
echo "  实际传输(gzip): $(curl -sk $R -H 'Accept-Encoding: gzip' -o /dev/null -w '%{size_download}' $B/assets/index-3POY8y4R.js) bytes"
echo "  未压缩:         $(curl -sk $R -H 'Accept-Encoding: identity' -o /dev/null -w '%{size_download}' $B/assets/index-3POY8y4R.js) bytes"

echo "== motion JSON: gzip 生效？ =="
curl -sk $R -H "Accept-Encoding: gzip,br" -o /dev/null -D - "$B/models/natori/motions/mtn_03.motion3.json" \
  | grep -iE "content-encoding|cache-control"
echo "  gzip: $(curl -sk $R -H 'Accept-Encoding: gzip' -o /dev/null -w '%{size_download}' $B/models/natori/motions/mtn_03.motion3.json) bytes / identity: $(curl -sk $R -H 'Accept-Encoding: identity' -o /dev/null -w '%{size_download}' $B/models/natori/motions/mtn_03.motion3.json) bytes"

echo "== WebP 纹理：状态/类型/缓存 =="
for f in /models/hiyori/Hiyori.2048/texture_00.webp /models/hiyori/Hiyori.2048/texture_01.webp /models/hiyori/Hiyori.2048/texture_00.sd.webp; do
  echo "--- $f"
  curl -sk $R -o /dev/null -w "  http:%{http_code} type:%{content_type} bytes:%{size_download}\n" -D /tmp/h.txt "$B$f"
  grep -i "cache-control" /tmp/h.txt | sed 's/^/  /'
done

echo "== index.html: 必须 no-cache =="
curl -sk $R -o /dev/null -D - "$B/" | grep -iE "cache-control|content-type"

echo "== 首屏关键资源总传输量（桌面 HD，Hiyori）估算 =="
JS=$(curl -sk $R -H 'Accept-Encoding: gzip' -o /dev/null -w '%{size_download}' $B/assets/index-3POY8y4R.js)
MOC=$(curl -sk $R -o /dev/null -w '%{size_download}' $B/models/hiyori/Hiyori.moc3)
T0=$(curl -sk $R -o /dev/null -w '%{size_download}' $B/models/hiyori/Hiyori.2048/texture_00.webp)
T1=$(curl -sk $R -o /dev/null -w '%{size_download}' $B/models/hiyori/Hiyori.2048/texture_01.webp)
echo "  JS(gzip)=$JS  moc3=$MOC  tex00.webp=$T0  tex01.webp=$T1"
echo "  合计关键字节: $((JS+MOC+T0+T1)) bytes ($(( (JS+MOC+T0+T1)/1024 )) KB)"
