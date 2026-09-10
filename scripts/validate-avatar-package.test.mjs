/**
 * scripts/validate-avatar-package.test.mjs — 资产包校验器测试（V2.0 Task 5）
 *
 * spec 要求先用 fixture 角色包覆盖失败路径：manifest / hash / anchor / capability 校验失败。
 * 完整合法 fixture 在临时目录现场生成（含占位 moc3 字节，仅 fixture 用途，严禁当作生产资产）；
 * 失败用例在合法 fixture 基础上做最小破坏，逐项击穿对应检查。
 *
 * 运行：node --test scripts/validate-avatar-package.test.mjs
 */
import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { ANCHOR_NAMES } from '../shared/dist/index.js'
import { validateAvatarPackage } from './validate-avatar-package.mjs'

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

let root

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'avatar-pkg-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

/** 生成一个完整合法的 fixture 角色包（结构镜像真实 Cubism 导出布局） */
function makeValidPkg(id = 'jing') {
  const dir = join(root, id)
  mkdirSync(join(dir, 'expressions'), { recursive: true })
  mkdirSync(join(dir, 'motions'), { recursive: true })
  mkdirSync(join(dir, 'textures'), { recursive: true })

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
  const anchors = Object.fromEntries(
    ANCHOR_NAMES.map((n, i) => [n, { x: 0.1 + i * 0.1, y: 0.2 + i * 0.05 }]),
  )
  const capabilities = {
    actionIds: ['idle', 'wave'],
  }
  const manifest = {
    avatarId: id,
    name: id === 'jing' ? 'Jing' : 'Tao',
    engine: 'cubism5',
    version: '1.0.0',
    model3Url: `${id}.model3.json`,
    anchors,
    capabilities: [
      { actionId: 'idle', motion: 'motions/idle.motion3.json', expression: 'happy' },
      { actionId: 'wave', motion: 'motions/wave.motion3.json', degradesTo: ['idle'] },
    ],
    textures: {
      4096: `textures/${id}.4096.png`,
      2048: `textures/${id}.2048.png`,
      1024: `textures/${id}.1024.png`,
    },
    files: {},
  }

  const fileBufs = {
    [`${id}.model3.json`]: Buffer.from(JSON.stringify(model3)),
    [`${id}.moc3`]: Buffer.from(`MOC3-FIXTURE-NOT-PRODUCTION-${id}`), // 占位字节，仅为通过文件存在性
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
    'manifest.json': Buffer.from(JSON.stringify(manifest)),
  }
  for (const [rel, buf] of Object.entries(fileBufs)) {
    writeFileSync(join(dir, rel), buf)
    if (rel !== 'manifest.json') manifest.files[rel] = sha256(buf)
  }
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2))
  return dir
}

test('完整合法 fixture 包 → ok=true，全部检查通过', () => {
  const dir = makeValidPkg()
  const report = validateAvatarPackage(dir)
  assert.equal(report.ok, true, JSON.stringify(report.errors))
  for (const v of Object.values(report.checks)) assert.equal(v, true)
  assert.deepEqual(report.errors, [])
})

test('manifest 校验失败：engine 非法', () => {
  const dir = makeValidPkg()
  const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
  m.engine = 'cubism99'
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(m))
  const report = validateAvatarPackage(dir)
  assert.equal(report.ok, false)
  assert.equal(report.checks.manifest, false)
  assert.ok(report.errors.some((e) => e.includes('manifest')))
})

test('manifest 校验失败：缺锚点（anchors 少一个）', () => {
  const dir = makeValidPkg()
  const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
  delete m.anchors['hand.left']
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(m))
  const report = validateAvatarPackage(dir)
  assert.equal(report.checks.manifest, false)
  assert.ok(report.errors.some((e) => e.includes('hand.left')))
})

test('必需文件校验失败：moc3 缺失', () => {
  const dir = makeValidPkg()
  rmSync(join(dir, 'jing.moc3'))
  const report = validateAvatarPackage(dir)
  assert.equal(report.checks.files, false)
  assert.ok(report.errors.some((e) => e.includes('moc3')))
})

test('目录校验失败：motions 目录缺失', () => {
  const dir = makeValidPkg()
  rmSync(join(dir, 'motions'), { recursive: true })
  const report = validateAvatarPackage(dir)
  assert.equal(report.checks.dirs, false)
  assert.ok(report.errors.some((e) => e.includes('motions')))
})

test('纹理三档校验失败：1024 档缺失', () => {
  const dir = makeValidPkg()
  rmSync(join(dir, 'textures', 'jing.1024.png'))
  const report = validateAvatarPackage(dir)
  assert.equal(report.checks.textures, false)
  assert.ok(report.errors.some((e) => e.includes('1024')))
})

test('anchors.json 校验失败：缺 foot.right', () => {
  const dir = makeValidPkg()
  const a = JSON.parse(readFileSync(join(dir, 'anchors.json'), 'utf8'))
  delete a['foot.right']
  writeFileSync(join(dir, 'anchors.json'), JSON.stringify(a))
  const report = validateAvatarPackage(dir)
  assert.equal(report.checks.anchors, false)
  assert.ok(report.errors.some((e) => e.includes('foot.right')))
})

test('capabilities.json 校验失败：缺 idle / 与 manifest 能力不一致', () => {
  const dir = makeValidPkg()
  writeFileSync(join(dir, 'capabilities.json'), JSON.stringify({ actionIds: ['wave'] }))
  const report = validateAvatarPackage(dir)
  assert.equal(report.checks.capabilities, false)
  assert.ok(report.errors.some((e) => e.includes('idle')))

  const dir2 = makeValidPkg('tao')
  writeFileSync(join(dir2, 'capabilities.json'), JSON.stringify({ actionIds: ['idle', 'wave', 'dance'] }))
  const report2 = validateAvatarPackage(dir2)
  assert.equal(report2.checks.capabilities, false)
  assert.ok(report2.errors.some((e) => e.includes('dance')))
})

test('capability.motion 文件缺失 → motions 检查失败', () => {
  const dir = makeValidPkg()
  rmSync(join(dir, 'motions', 'wave.motion3.json'))
  const report = validateAvatarPackage(dir)
  assert.equal(report.checks.motions, false)
  assert.ok(report.errors.some((e) => e.includes('wave.motion3.json')))
})

test('hash 校验失败：文件内容被篡改', () => {
  const dir = makeValidPkg()
  writeFileSync(join(dir, 'motions', 'idle.motion3.json'), Buffer.from('tampered'))
  const report = validateAvatarPackage(dir)
  assert.equal(report.checks.hashes, false)
  assert.ok(report.errors.some((e) => e.includes('hash')))
})

test('hash 校验失败：manifest.files 未覆盖必需文件（warning）', () => {
  const dir = makeValidPkg()
  const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
  delete m.files['jing.moc3']
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(m))
  const report = validateAvatarPackage(dir)
  assert.ok(report.warnings.some((w) => w.includes('jing.moc3')))
})

test('包目录不存在 → ok=false，报 PKG_DIR_MISSING', () => {
  const report = validateAvatarPackage(join(root, 'nope'))
  assert.equal(report.ok, false)
  assert.ok(report.errors.some((e) => e.includes('PKG_DIR_MISSING')))
})
