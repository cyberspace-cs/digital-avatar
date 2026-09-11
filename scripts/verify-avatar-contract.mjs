/**
 * scripts/verify-avatar-contract.mjs — Jing/Tao 正式角色包发布门禁（V2.0 Task 8）
 *
 * 规则（契约 §3.3 + spec Task 8"所有验收通过后再发布 Jing/Tao 正式角色包"）：
 *   releasable = 契约校验全部通过(validateAvatarPackage.ok) 且 manifest.placeholder !== true
 *
 * 双模式：
 *   1. 测试模式（node --test 本文件，随 pnpm test:scripts 执行）：
 *      - 当前仓库里的 jing/tao 是占位包 → 必须被门禁阻断（防止误发布空壳）
 *      - 合成"合法且非占位"fixture → 必须放行（验证门禁不会永远卡死）
 *      - 合成"非占位但契约损坏"fixture → 必须阻断
 *   2. 发布门禁 CLI：node scripts/verify-avatar-contract.mjs --release
 *      两个包全部 releasable 才退出 0；任一阻断退出 1（接发布流水线）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { ANCHOR_NAMES } from '../shared/dist/index.js'
import { validateAvatarPackage } from './validate-avatar-package.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MODELS_DIR = join(__dirname, '..', 'client', 'public', 'models')
const RELEASE_PACKAGES = ['jing', 'tao']

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

function readManifest(pkgDir) {
  try {
    return JSON.parse(readFileSync(join(pkgDir, 'manifest.json'), 'utf8'))
  } catch {
    return null
  }
}

/**
 * 发布门禁评估。永不抛错：任何异常都视为不可发布（门禁宁可误拦，不可漏放）。
 * 返回 { pkg, exists, placeholder, report, releasable, reasons }
 */
export function evaluateRelease(pkgName, baseDir = MODELS_DIR) {
  const pkgDir = join(baseDir, pkgName)
  const reasons = []
  if (!existsSync(pkgDir)) {
    return { pkg: pkgName, exists: false, placeholder: false, report: null, releasable: false, reasons: ['PKG_MISSING'] }
  }
  const manifest = readManifest(pkgDir)
  const placeholder = manifest?.placeholder === true
  if (placeholder) reasons.push('PLACEHOLDER: 仍是占位包，正式资产未接入')
  if (!manifest) reasons.push('MANIFEST_MISSING')
  let report = null
  try {
    report = validateAvatarPackage(pkgDir)
    if (!report.ok) reasons.push(...report.errors.map((e) => `CONTRACT: ${e}`))
  } catch (e) {
    reasons.push(`VALIDATOR_THREW: ${e?.message ?? e}`)
  }
  return { pkg: pkgName, exists: true, placeholder, report, releasable: reasons.length === 0, reasons }
}

/** 在临时目录合成完整合法 fixture（结构镜像真实导出，字节为占位，仅测试用途） */
function makeValidFixturePkg(root, id = 'jing', { placeholder = false, engine = 'cubism5' } = {}) {
  const dir = join(root, id)
  const sprite = engine === 'sprite-sequence'
  mkdirSync(dir, { recursive: true })
  if (!sprite) {
    mkdirSync(join(dir, 'expressions'), { recursive: true })
    mkdirSync(join(dir, 'motions'), { recursive: true })
    mkdirSync(join(dir, 'textures'), { recursive: true })
  }

  const model3 = {
    Version: 3,
    FileReferences: {
      Moc: `${id}.moc3`,
      Textures: [`textures/${id}.2048.png`],
      Physics: `${id}.physics3.json`,
      Pose: `${id}.pose3.json`,
      DisplayInfo: `${id}.cdi3.json`,
    },
  }
  const anchors = Object.fromEntries(ANCHOR_NAMES.map((n, i) => [n, { x: 0.1 + i * 0.1, y: 0.2 + i * 0.05 }]))
  const capabilities = { actionIds: ['idle', 'wave'] }
  const manifest = {
    avatarId: id,
    name: id === 'jing' ? 'Jing' : 'Tao',
    engine,
    version: '1.0.0',
    model3Url: sprite ? 'idle.png' : `${id}.model3.json`,
    anchors,
    capabilities: sprite
      ? [
        { actionId: 'idle', motion: 'idle.png' },
        { actionId: 'wave', motion: 'frames/wave/frame_01.png', frames: ['frames/wave/frame_01.png', 'frames/wave/frame_02.png'], degradesTo: ['idle'] },
      ]
      : [
        { actionId: 'idle', motion: 'motions/idle.motion3.json', expression: 'happy' },
        { actionId: 'wave', motion: 'motions/wave.motion3.json', degradesTo: ['idle'] },
      ],
    textures: sprite
      ? undefined
      : {
        4096: `textures/${id}.4096.png`,
        2048: `textures/${id}.2048.png`,
        1024: `textures/${id}.1024.png`,
      },
    files: {},
  }
  if (placeholder) manifest.placeholder = true

  const bufs = sprite
    ? {
      'idle.png': Buffer.from('PNG-idle-fixture'),
      'frames/wave/frame_01.png': Buffer.from('PNG-wave-1-fixture'),
      'frames/wave/frame_02.png': Buffer.from('PNG-wave-2-fixture'),
      'anchors.json': Buffer.from(JSON.stringify(anchors)),
      'capabilities.json': Buffer.from(JSON.stringify(capabilities)),
    }
    : {
      [`${id}.model3.json`]: Buffer.from(JSON.stringify(model3)),
      [`${id}.moc3`]: Buffer.from(`MOC3-FIXTURE-NOT-PRODUCTION-${id}`),
      [`${id}.physics3.json`]: Buffer.from('{}'),
      [`${id}.pose3.json`]: Buffer.from('{}'),
      [`${id}.cdi3.json`]: Buffer.from('{}'),
      'expressions/happy.exp3.json': Buffer.from('{}'),
      'motions/idle.motion3.json': Buffer.from('{}'),
      'motions/wave.motion3.json': Buffer.from('{}'),
      [`textures/${id}.4096.png`]: Buffer.from('PNG4096-fixture'),
      [`textures/${id}.2048.png`]: Buffer.from('PNG2048-fixture'),
      [`textures/${id}.1024.png`]: Buffer.from('PNG1024-fixture'),
      'anchors.json': Buffer.from(JSON.stringify(anchors)),
      'capabilities.json': Buffer.from(JSON.stringify(capabilities)),
    }
  for (const [rel, buf] of Object.entries(bufs)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true })
    writeFileSync(join(dir, rel), buf)
    manifest.files[rel] = sha256(buf)
  }
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2))
  return dir
}

// ---------- 测试模式（node --test 或直接 node 执行都会跑这些测试） ----------
{
  let root
  test.beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'avatar-release-')) })
  test.afterEach(() => { rmSync(root, { recursive: true, force: true }) })

  test('发布门禁：仓库内 jing/tao 正式 sprite 包（V2.1 QQ秀路线）必须放行', () => {
    for (const pkg of RELEASE_PACKAGES) {
      const r = evaluateRelease(pkg)
      assert.equal(r.exists, true, `${pkg} 包目录应存在`)
      assert.equal(r.placeholder, false, `${pkg} manifest 不应再是占位包`)
      assert.equal(r.releasable, true, `${pkg} 正式 sprite 包应通过发布门禁：${r.reasons.join('; ')}`)
    }
  })

  test('发布门禁：占位包（fixture placeholder=true）必须被阻断（语义保留）', () => {
    const base = mkdirSync(join(root, 'models'), { recursive: true })
    makeValidFixturePkg(base, 'jing', { placeholder: true })
    const r = evaluateRelease('jing', base)
    assert.equal(r.releasable, false, '占位包绝不能通过发布门禁')
    assert.ok(r.reasons.some((x) => x.startsWith('PLACEHOLDER')))
  })

  test('发布门禁：合法且非占位的正式 fixture（cubism5）放行', () => {
    const base = mkdirSync(join(root, 'models'), { recursive: true })
    makeValidFixturePkg(base, 'jing', { placeholder: false })
    const r = evaluateRelease('jing', base)
    assert.equal(r.releasable, true, `合法正式包应放行：${r.reasons.join('; ')}`)
  })

  test('发布门禁：非占位但契约损坏（删 moc3 / 删帧）仍阻断', () => {
    const base = mkdirSync(join(root, 'models-cubism'), { recursive: true })
    const dir = makeValidFixturePkg(base, 'tao', { placeholder: false })
    rmSync(join(dir, 'tao.moc3'))
    const r = evaluateRelease('tao', base)
    assert.equal(r.releasable, false)
    assert.ok(r.reasons.some((x) => x.startsWith('CONTRACT:')))

    const base2 = mkdirSync(join(root, 'models-sprite'), { recursive: true })
    const dir2 = makeValidFixturePkg(base2, 'tao', { placeholder: false, engine: 'sprite-sequence' })
    rmSync(join(dir2, 'frames', 'wave', 'frame_02.png'))
    const r2 = evaluateRelease('tao', base2)
    assert.equal(r2.releasable, false, `缺帧包必须阻断：${r2.reasons.join('; ')}`)
    assert.ok(r2.reasons.some((x) => x.includes('FRAME_MISSING')))
  })

  test('发布门禁：包目录缺失按不可发布处理（不抛错）', () => {
    const r = evaluateRelease('ghost', join(root, 'none'))
    assert.equal(r.releasable, false)
    assert.deepEqual(r.reasons, ['PKG_MISSING'])
  })
}

// ---------- CLI 发布门禁（仅 --release 时执行；测试运行不带该参数） ----------
const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href
if (isMain && process.argv.includes('--release')) {
  let failed = 0
  for (const pkg of RELEASE_PACKAGES) {
    const r = evaluateRelease(pkg)
    if (r.releasable) {
      console.log(`✅ ${pkg}: releasable`)
    } else {
      failed++
      console.error(`🛑 ${pkg}: BLOCKED`)
      for (const reason of r.reasons) console.error(`   - ${reason}`)
    }
  }
  if (failed > 0) {
    console.error(`\n发布门禁未通过（${failed}/${RELEASE_PACKAGES.length} 个包不可发布）。正式资产接入后重跑本脚本。`)
    process.exit(1)
  }
  console.log('\n发布门禁全部通过，可发布 Jing/Tao 正式角色包。')
}
