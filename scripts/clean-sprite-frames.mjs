/**
 * scripts/clean-sprite-frames.mjs — action-board 帧背景清理（V2.1 零人工管线预处理，纯 Node）
 *
 * 背景：豆包交付的 tao_*.png 实际是 JPEG（假透明棋盘格被画进像素）；jing_*.png 是白底 PNG。
 * 流程：jpeg-js/png-codec 解码 → 边缘采样背景色 → flood-fill 摘背景 → 1px 边缘衰减 →
 *       输出真透明 PNG 到 docs/assets/action-boards/clean/{jing,tao}/
 * 同时输出帧间差异诊断（验证动作序列有效性）。
 *
 * QQ秀证据（docs/CHANGELOG V2.1）：帧动画自然度=循环播放 + 2-10帧@4-10fps（QQ 闪动头像机制，百度百科）。
 */
import jpeg from '../client/node_modules/jpeg-js/index.js'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { decodePng, encodePng } from './png-codec.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const BOARDS = join(__dirname, '..', 'docs', 'assets', 'action-boards')

const GROUPS = [
  { id: 'jing', dir: join(BOARDS, 'jing'), prefix: 'girl_', actions: ['wave', 'heart'], tol: 20 },
  { id: 'tao', dir: join(BOARDS, 'tao'), prefix: 'tao_', actions: ['wave', 'heart'], tol: 30 }, // tao=JPEG 棋盘格+压缩噪声，容差放宽
]

/** 任意帧文件 → RGBA（png 或 jpeg） */
function decodeAny(path) {
  const buf = readFileSync(path)
  if (buf[0] === 0x89 && buf[1] === 0x50) return decodePng(buf)
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    const img = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true })
    return { width: img.width, height: img.height, rgba: new Uint8Array(img.data) }
  }
  throw new Error(`unsupported image: ${path}`)
}

function cleanFrame({ width: W, height: H, rgba: d }, tol) {
  // 边缘采样背景候选色
  const bg = []
  const step = Math.max(4, Math.floor(W / 64))
  const sample = (x, y) => { const o = (y * W + x) * 4; bg.push([d[o], d[o + 1], d[o + 2]]) }
  for (let x = 0; x < W; x += step) { sample(x, 0); sample(x, 1); sample(x, H - 1); sample(x, H - 2) }
  for (let y = 0; y < H; y += step) { sample(0, y); sample(1, y); sample(W - 1, y); sample(W - 2, y) }

  const near = (o, t) => {
    for (const c of bg) {
      const dr = d[o] - c[0], dg = d[o + 1] - c[1], db = d[o + 2] - c[2]
      if (dr * dr + dg * dg + db * db < t * t) return true
    }
    return false
  }

  // flood-fill（4 连通）从四边摘背景
  const visited = new Uint8Array(W * H)
  const stack = []
  const push = (x, y) => {
    const i = y * W + x
    if (!visited[i] && d[i * 4 + 3] !== 0 && near(i * 4, tol)) { visited[i] = 1; stack.push(i) }
  }
  for (let x = 0; x < W; x++) { push(x, 0); push(x, H - 1) }
  for (let y = 0; y < H; y++) { push(0, y); push(W - 1, y) }
  let removed = 0
  while (stack.length) {
    const i = stack.pop()
    d[i * 4 + 3] = 0
    removed++
    const x = i % W, y = (i / W) | 0
    if (x > 0) push(x - 1, y)
    if (x < W - 1) push(x + 1, y)
    if (y > 0) push(x, y - 1)
    if (y < H - 1) push(x, y + 1)
  }

  // 1px 边缘衰减：紧贴透明区且仍偏背景色的像素 → 半透明（弱化棋盘格/JPEG 残迹）
  const alphaSnapshot = new Uint8Array(W * H)
  for (let i = 0; i < W * H; i++) alphaSnapshot[i] = d[i * 4 + 3]
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x
    if (alphaSnapshot[i] < 255) continue
    if (!alphaSnapshot[i - 1] || !alphaSnapshot[i + 1] || !alphaSnapshot[i - W] || !alphaSnapshot[i + W]) {
      if (near(i * 4, tol * 1.6)) d[i * 4 + 3] = 90
    }
  }

  // alpha 归一化：AI 导出把主体 alpha 卡在 241-254（jing 实测 255 仅占 0.3%）→ ≥241 拉满，
  // 否则舞台渲染立绘整体发白/透底。241 以下的羽化边缘保留渐变。
  for (let i = 3; i < d.length; i += 4) {
    if (d[i] >= 241) d[i] = 255
  }
  return { removedPct: +(100 * removed / (W * H)).toFixed(1) }
}

for (const g of GROUPS) {
  const outDir = join(BOARDS, 'clean', g.id)
  mkdirSync(outDir, { recursive: true })
  for (const act of g.actions) {
    let prev = null
    const parts = []
    for (let i = 1; i <= 5; i++) {
      const frame = decodeAny(join(g.dir, `${g.prefix}${act}_0${i}.png`))
      // 帧间差异（清理前诊断）
      let diff = 0
      if (prev) {
        for (let j = 0; j < frame.rgba.length; j += 4) {
          const s = Math.abs(frame.rgba[j] - prev[j]) + Math.abs(frame.rgba[j + 1] - prev[j + 1]) + Math.abs(frame.rgba[j + 2] - prev[j + 2])
          if (s > 60) diff++
        }
      }
      prev = frame.rgba.slice()
      const { removedPct } = cleanFrame(frame, g.tol)
      const outPath = join(outDir, `${g.prefix}${act}_0${i}.png`)
      writeFileSync(outPath, encodePng(frame.width, frame.height, frame.rgba))
      parts.push(`f${i}(diff ${(100 * diff / (frame.width * frame.height)).toFixed(1)}% bg ${removedPct}%)`)
    }
    console.log(`${g.id}/${act}:`, parts.join(' '))
  }
}
console.log('clean frames written to docs/assets/action-boards/clean/')
