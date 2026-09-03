# Texture WebP: 把 HD/SD 纹理 PNG 转成 WebP（带 alpha，体积约为 PNG 的 1/6~1/8）。
# HD texture_XX.png      -> texture_XX.webp      (quality 88，桌面端用)
# SD texture_XX.sd.png   -> texture_XX.sd.webp   (quality 82，移动端用)
# 增量：webp 已存在且比 png 新则跳过。PNG 原文件保留作为不支持 WebP 时的兜底。
#
# 依赖 ffmpeg（libwebp 编码器，yuva420p 保留透明通道）。

$ErrorActionPreference = "Stop"

$root = Join-Path (Split-Path -Parent $PSScriptRoot) "client/public/models"
if (-not (Test-Path $root)) { Write-Warning "models dir missing: $root"; exit 1 }

$ffmpeg = Get-Command ffmpeg -ErrorAction SilentlyContinue
if (-not $ffmpeg) { Write-Warning "ffmpeg not found in PATH"; exit 1 }

function Convert-One([string]$png, [int]$quality) {
  $webp = [System.IO.Path]::ChangeExtension($png, ".webp")
  if (Test-Path $webp) {
    $w = Get-Item $webp; $p = Get-Item $png
    if ($w.LastWriteTimeUtc -ge $p.LastWriteTimeUtc -and $w.Length -gt 0) { return "skip" }
  }
  $tmp = $webp + ".tmp"
  & ffmpeg -y -loglevel error -i $png -c:v libwebp -quality $quality -compression_level 6 -f webp $tmp
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path $tmp)) { Write-Warning "FAIL $png"; if (Test-Path $tmp) { Remove-Item $tmp }; return "fail" }
  Move-Item -Force $tmp $webp
  $before = [math]::Round((Get-Item $png).Length / 1KB)
  $after  = [math]::Round((Get-Item $webp).Length / 1KB)
  Write-Host ("webp: {0}  {1}KB -> {2}KB" -f (Split-Path $png -Leaf), $before, $after)
  return "ok"
}

$ok = 0; $skip = 0; $fail = 0
Get-ChildItem -Path $root -Recurse -Filter *.png | ForEach-Object {
  $isSd = $_.Name -like "*.sd.png"
  $q = if ($isSd) { 82 } else { 88 }
  switch (Convert-One $_.FullName $q) {
    "ok"   { $script:ok++ }
    "skip" { $script:skip++ }
    "fail" { $script:fail++ }
  }
}

Write-Host ("DONE: converted={0}, skipped={1}, failed={2}" -f $ok, $skip, $fail)
