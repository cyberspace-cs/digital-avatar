#!/bin/bash
# 部署新 dist：备份当前版本（可回滚）→ 解压新版 → 校验
set -e
cd /home/ubuntu/digital-avatar/client
TS=$(date +%Y%m%d-%H%M%S)

echo "== backup current dist =="
if [ -d dist ]; then
  rm -rf dist.bak.$TS
  cp -r dist dist.bak.$TS
  echo "backup: dist.bak.$TS"
  # 只保留最近 3 个备份
  ls -dt dist.bak.* 2>/dev/null | tail -n +4 | xargs -r rm -rf
fi

echo "== extract new dist =="
rm -rf dist.new
mkdir dist.new
tar xzf /tmp/dist-webp.tar.gz -C dist.new
# 原子替换
rm -rf dist.old_swap
mv dist dist.old_swap
mv dist.new dist
rm -rf dist.old_swap

echo "== verify =="
ls dist/ | head
echo "index asset: $(grep -oE 'assets/index-[a-zA-Z0-9._-]+\.js' dist/index.html | head -1)"
echo "webp count: $(find dist/models -name '*.webp' | wc -l)"
echo "webp sample sizes:"
du -h dist/models/hiyori/Hiyori.2048/*.webp
