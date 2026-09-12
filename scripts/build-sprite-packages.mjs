/**
 * scripts/build-sprite-packages.mjs — Jing/Tao sprite-sequence 角色包组装（V2.1 QQ秀路线）
 *
 * 零人工管线：docs/assets/action-boards 里的 AI 生成 5 帧动作序列（wave/heart）直接
 * 就是正式运行时资产（QQ秀"动作即素材包"），本脚本把它们组装成过契约的角色包：
 *   client/public/models/<id>/
 *     idle.png                      ← wave_01（自然站姿，QQ秀式静态待机）
 *     frames/wave/frame_01..05.png
 *     frames/heart/frame_01..05.png
 *     manifest.json                 ← engine=sprite-sequence + 9 锚点 + 能力表 + sha256
 *     anchors.json / capabilities.json
 *
 * 新增动作 = AI 生成新 5 帧 → 在 SPEC.frames 加一组 → 重跑本脚本 → 发包即上线。
 * CLI：node scripts/build-sprite-packages.mjs [--check]（--check 只校验不落盘）
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const FRAMES = 5
/** 统一锚点（0~1 归一化，站姿通用比例——与占位包相同，QQ秀级精度足够走位/贴靠） */
const ANCHORS = {
  head: { x: 0.5, y: 0.08 },
  'hand.left': { x: 0.18, y: 0.45 },
  'hand.right': { x: 0.82, y: 0.45 },
  'foot.left': { x: 0.35, y: 1 },
  'foot.right': { x: 0.65, y: 1 },
  heart: { x: 0.5, y: 0.35 },
  shoulder: { x: 0.5, y: 0.25 },
  'hug.chest': { x: 0.5, y: 0.42 },
  root: { x: 0.5, y: 1 },
}

const SPEC = [
  {
    id: 'jing',
    name: 'Jing',
    dir: join(ROOT, 'docs', 'assets', 'action-boards', 'jing'),
    wave: 'girl_wave',
    heart: 'girl_heart',
  },
  {
    id: 'tao',
    name: 'Tao',
    dir: join(ROOT, 'docs', 'assets', 'action-boards', 'tao'),
    wave: 'tao_wave',
    heart: 'tao_heart',
  },
]
/** 优先取 clean/（clean-sprite-frames.mjs 产物：真透明背景 + alpha 归一化），缺帧回退原始目录 */
const srcFrame = (spec, stem, i) => {
  const cleaned = join(ROOT, 'docs', 'assets', 'action-boards', 'clean', spec.id, `${stem}_${pad2(i)}.png`)
  return existsSync(cleaned) ? cleaned : join(spec.dir, `${stem}_${pad2(i)}.png`)
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')
const pad2 = (n) => String(n).padStart(2, '0')

const checkOnly = process.argv.includes('--check')
const problems = []

for (const spec of SPEC) {
  const outDir = join(ROOT, 'client', 'public', 'models', spec.id)
  /** relPath → Buffer（组装期收集，统一落盘 + 算 hash） */
  const files = new Map()

  // ---- 帧序列：wave / heart ----
  const clips = []
  for (const [actionId, stem] of [
    ['wave', spec.wave],
    ['heart', spec.heart],
  ]) {
    const frames = []
    for (let i = 1; i <= FRAMES; i++) {
      const src = srcFrame(spec, stem, i)
      if (!existsSync(src)) {
        problems.push(`${spec.id}: 缺源帧 ${src}`)
        continue
      }
      const rel = `frames/${actionId}/frame_${pad2(i)}.png`
      files.set(rel, readFileSync(src))
      frames.push(rel)
    }
    if (frames.length === FRAMES) {
      clips.push({
        actionId,
        motion: frames[0],
        frames,
        // 不声明 expression：序列帧形象的"表情"由程序动效（呼吸/弹跳）表达，无 exp3 文件
        degradesTo: actionId === 'heart' ? ['wave', 'idle'] : ['idle'],
      })
    }
  }

  // ---- idle 立绘 = wave_01（自然站姿，取清理后版本）----
  const idleSrc = srcFrame(spec, spec.wave, 1)
  if (!existsSync(idleSrc)) problems.push(`${spec.id}: 缺 idle 源图 ${idleSrc}`)
  else files.set('idle.png', readFileSync(idleSrc))

  if (problems.length > 0) continue

  // ---- manifest ----
  const manifest = {
    avatarId: spec.id,
    name: spec.name,
    engine: 'sprite-sequence',
    version: '1.0.0',
    // QQ秀式待机：基准立绘路径（契约 model3Url 字段复用为"主视觉资源路径"）
    model3Url: 'idle.png',
    placeholder: false,
    anchors: ANCHORS,
    capabilities: [{ actionId: 'idle', motion: 'idle.png' }, ...clips],
    thumbnailUrl: 'idle.png',
    files: Object.fromEntries([...files.entries()].map(([rel, buf]) => [rel, sha256(buf)])),
  }
  const manifestBuf = Buffer.from(JSON.stringify(manifest, null, 2) + '\n')
  const anchorsBuf = Buffer.from(JSON.stringify(ANCHORS, null, 2) + '\n')
  const capsBuf = Buffer.from(
    JSON.stringify({ actionIds: ['idle', ...clips.map((c) => c.actionId)] }, null, 2) + '\n',
  )

  console.log(`[${spec.id}] ${files.size} 张帧图 → ${outDir}`)
  console.log(`  clips: ${clips.map((c) => `${c.actionId}×${c.frames.length}`).join(', ')}`)
  if (checkOnly) continue

  for (const [rel, buf] of files) {
    const dst = join(outDir, rel)
    mkdirSync(dirname(dst), { recursive: true })
    writeFileSync(dst, buf)
  }
  writeFileSync(join(outDir, 'manifest.json'), manifestBuf)
  writeFileSync(join(outDir, 'anchors.json'), anchorsBuf)
  writeFileSync(join(outDir, 'capabilities.json'), capsBuf)
}

if (problems.length > 0) {
  console.error('\n组装失败（缺源素材）：')
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}
console.log(checkOnly ? '\n--check 通过：源素材齐全。' : '\n角色包组装完成（placeholder=false，过 sha256 门禁）。')
