# Texture LOD: build half-size SD versions (foo.png -> foo.sd.png) for every HD texture.
# Safe incremental run: skip if sd exists and is newer than HD.

Add-Type -AssemblyName System.Drawing

$root = Join-Path (Split-Path -Parent $PSScriptRoot) "client/public/models"
if (-not (Test-Path $root)) { Write-Warning "models dir missing: $root"; exit 1 }

$count = 0
$skip = 0

Get-ChildItem -Path $root -Recurse -Filter *.png | Where-Object {
  $_.Name -notlike "*.sd.png"
} | ForEach-Object {
  $hd = $_.FullName
  $sd = Join-Path $_.DirectoryName ($_.BaseName + ".sd" + $_.Extension)
  if (Test-Path $sd) {
    $sdInfo = Get-Item $sd
    if ($sdInfo.LastWriteTimeUtc -ge $_.LastWriteTimeUtc -and $sdInfo.Length -gt 0) {
      $script:skip++; return
    }
  }
  try {
    $src = [System.Drawing.Image]::FromFile($hd)
    $w = [Math]::Max(1, [int]($src.Width / 2))
    $h = [Math]::Max(1, [int]($src.Height / 2))
    $dst = New-Object System.Drawing.Bitmap($w, $h)
    $g = [System.Drawing.Graphics]::FromImage($dst)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.DrawImage($src, 0, 0, $w, $h)
    $dst.Save($sd, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $dst.Dispose(); $src.Dispose()
    $script:count++
    Write-Host ("sd: {0} {1}x{2} -> {3}x{4}" -f $_.Name, $src.Width, $src.Height, $w, $h)
  } catch {
    Write-Warning ("FAIL {0} : {1}" -f $hd, $_.Exception.Message)
  }
}

Write-Host ("DONE: new/updated={0}, skipped={1}" -f $count, $skip)
