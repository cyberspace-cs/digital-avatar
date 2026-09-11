/**
 * scripts/validate-avatar-package.mjs — Cubism5 角色资产包校验器（V2.0 Task 5，契约 §3.3）
 *
 * validateAvatarPackage(path) → ValidationReport：
 *   { path, ok, errors: string[], warnings: string[],
 *     checks: { manifest, files, dirs, textures, anchors, capabilities, motions, hashes } }
 *
 * 校验项（spec Task 5）：
 *   - manifest.json 存在且通过 shared.parseAvatarManifest 契约校验（含 9 锚点 + 能力表）
 *   - model3.json / moc3 / physics3.json / pose3.json / cdi3.json 存在（优先按 model3.json
 *     FileReferences 解析引用；无法解析时回退 glob 约定命名）
 *   - expressions/ 与 motions/ 目录存在
 *   - 纹理 4096/2048/1024 三档在 manifest.textures 声明且文件存在
 *   - anchors.json 恰好覆盖 9 个统一锚点
 *   - capabilities.json 声明 actionId 列表，含 idle，且与 manifest.capabilities 一致
 *   - capability.motion / capability.expression 引用的文件存在
 *   - manifest.files 的 sha256 逐一比对；必需运行时文件未纳入 files → warning
 *
 * CLI：node scripts/validate-avatar-package.mjs <包目录>... （任一不合法退出码 1）
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

let shared
try {
  shared = await import('../shared/dist/index.js')
} catch (e) {
  throw new Error('shared 包未构建：先执行 pnpm --filter @digital-avatar/shared build')
}
const { parseAvatarManifest, ANCHOR_NAMES, TEXTURE_TIERS } = shared

/** 统一相对路径分隔符（manifest.files 键与 disk 查找都用 posix 风格） */
const posix = (p) => p.split('\\').join('/')

/** model3.json FileReferences（可缺失字段安全读取） */
function readModel3Refs(pkg, relModel3) {
  try {
    const m3 = JSON.parse(readFileSync(join(pkg, relModel3), 'utf8'))
    return m3?.FileReferences ?? null
  } catch {
    return null
  }
}

function globOne(pkg, re) {
  if (!existsSync(pkg)) return null
  const hit = readdirSync(pkg).find((f) => re.test(f))
  return hit ?? null
}

/**
 * 校验角色资产包目录。永不抛错——所有问题进 errors，软性问题进 warnings。
 */
export function validateAvatarPackage(pkgPath) {
  const report = {
    path: pkgPath,
    ok: false,
    errors: [],
    warnings: [],
    checks: { manifest: true, files: true, dirs: true, textures: true, anchors: true, capabilities: true, motions: true, hashes: true },
  }
  const fail = (check, msg) => { report.checks[check] = false; report.errors.push(msg) }
  const warn = (msg) => { report.warnings.push(msg) }

  if (!existsSync(pkgPath) || !statSync(pkgPath).isDirectory()) {
    fail('files', `PKG_DIR_MISSING: 包目录不存在: ${pkgPath}`)
    report.ok = false
    return report
  }

  // ---- manifest.json（契约校验：9 锚点 + capabilities 结构）----
  const manifestRel = 'manifest.json'
  let manifest = null
  if (!existsSync(join(pkgPath, manifestRel))) {
    fail('manifest', `MANIFEST_MISSING: 缺少 manifest.json`)
  } else {
    try {
      manifest = parseAvatarManifest(JSON.parse(readFileSync(join(pkgPath, manifestRel), 'utf8')))
    } catch (e) {
      fail('manifest', `MANIFEST_INVALID: manifest.json 校验失败: ${(e && e.message) || e}`)
    }
  }

  // ---- 必需运行时文件 ----
  // V2.1 sprite-sequence（QQ秀路线）：model3Url 复用为主视觉资源路径（idle.png），
  // 无 moc3/physics/pose/cdi、无 expressions/motions 目录、无纹理三档——跳过 Cubism 专属校验
  const isSprite = manifest?.engine === 'sprite-sequence'
  const requiredFiles = [] // [checkName, relPath]
  let model3Rel = manifest ? posix(manifest.model3Url).replace(/^\//, '') : null
  if (manifest) {
    if (!existsSync(join(pkgPath, model3Rel))) {
      fail('files', `FILE_MISSING: ${isSprite ? '主视觉资源(idle)' : 'model3.json'} 缺失: ${model3Rel}`)
      model3Rel = null
    } else {
      requiredFiles.push(model3Rel)
    }
  }

  if (!isSprite) {
    const refs = model3Rel ? readModel3Refs(pkgPath, model3Rel) : null
    const refTargets = refs
      ? { moc3: refs.Moc, physics3: refs.Physics, pose3: refs.Pose, cdi3: refs.DisplayInfo }
      : { moc3: globOne(pkgPath, /\.moc3$/), physics3: globOne(pkgPath, /\.physics3\.json$/), pose3: globOne(pkgPath, /\.pose3\.json$/), cdi3: globOne(pkgPath, /\.cdi3\.json$/) }
    for (const [kind, rel] of Object.entries(refTargets)) {
      if (!rel) { fail('files', `FILE_MISSING: ${kind} 文件未找到（${refs ? 'model3 未声明' : '包内无匹配'}）`); continue }
      if (!existsSync(join(pkgPath, rel))) fail('files', `FILE_MISSING: model3 引用缺失: ${rel}（${kind}）`)
      else requiredFiles.push(posix(rel))
    }

    // ---- 目录：expressions / motions ----
    for (const dirName of ['expressions', 'motions']) {
      const p = join(pkgPath, dirName)
      if (!existsSync(p) || !statSync(p).isDirectory()) fail('dirs', `DIR_MISSING: 目录缺失: ${dirName}/`)
    }

    // ---- 纹理三档 ----
    if (manifest) {
      for (const tier of TEXTURE_TIERS) {
        const rel = manifest.textures?.[tier]
        if (!rel) { fail('textures', `TEXTURE_MISSING_TIER: 纹理 ${tier} 档未在 manifest.textures 声明`); continue }
        if (!existsSync(join(pkgPath, rel))) fail('textures', `TEXTURE_MISSING: 纹理 ${tier} 档文件缺失: ${rel}`)
        else requiredFiles.push(posix(rel))
      }
    }
  } // end !isSprite

  // ---- anchors.json（9 统一锚点，恰好覆盖）----
  const anchorsRel = 'anchors.json'
  if (!existsSync(join(pkgPath, anchorsRel))) {
    fail('anchors', `ANCHORS_MISSING: 缺少 anchors.json`)
  } else {
    try {
      const a = JSON.parse(readFileSync(join(pkgPath, anchorsRel), 'utf8'))
      for (const name of ANCHOR_NAMES) {
        const pt = a?.[name]
        if (!pt || typeof pt.x !== 'number' || typeof pt.y !== 'number' || !Number.isFinite(pt.x) || !Number.isFinite(pt.y)) {
          fail('anchors', `ANCHORS_INVALID: anchors.json 缺少锚点或坐标非法: ${name}`)
        } else if (pt.x < 0 || pt.x > 1 || pt.y < 0 || pt.y > 1) {
          warn(`anchors.json 锚点 ${name} 坐标超出 0~1: (${pt.x}, ${pt.y})`)
        }
      }
      for (const k of Object.keys(a ?? {})) {
        if (!(ANCHOR_NAMES).includes(k)) fail('anchors', `ANCHORS_INVALID: anchors.json 未知锚点名: ${k}`)
      }
    } catch (e) {
      fail('anchors', `ANCHORS_INVALID: anchors.json 无法解析: ${(e && e.message) || e}`)
    }
  }

  // ---- capabilities.json（actionId 列表，与 manifest.capabilities 一致）----
  const capsRel = 'capabilities.json'
  let capsJson = null
  if (!existsSync(join(pkgPath, capsRel))) {
    fail('capabilities', `CAPABILITIES_MISSING: 缺少 capabilities.json`)
  } else {
    try {
      capsJson = JSON.parse(readFileSync(join(pkgPath, capsRel), 'utf8'))
    } catch (e) {
      fail('capabilities', `CAPABILITIES_INVALID: capabilities.json 无法解析: ${(e && e.message) || e}`)
    }
  }
  if (manifest && capsJson) {
    const list = capsJson?.actionIds
    if (!Array.isArray(list) || list.length === 0) {
      fail('capabilities', 'CAPABILITIES_INVALID: capabilities.json actionIds 必须是非空数组')
    } else {
      if (!list.includes('idle')) fail('capabilities', 'CAPABILITIES_INVALID: capabilities.json 缺少 idle 动作声明')
      const declared = new Set(manifest.capabilities.map((c) => c.actionId))
      const extra = list.filter((id) => !declared.has(id))
      const missing = [...declared].filter((id) => !list.includes(id))
      if (extra.length > 0) fail('capabilities', `CAPABILITIES_INVALID: capabilities.json 与 manifest.capabilities 不一致: 多出 ${extra.join(', ')}`)
      if (missing.length > 0) fail('capabilities', `CAPABILITIES_INVALID: capabilities.json 与 manifest.capabilities 不一致: 缺少 ${missing.join(', ')}`)
    }
  }

  // ---- 能力引用的运行时资产（motion/expression/frames 文件）----
  if (manifest) {
    for (const cap of manifest.capabilities) {
      if (!existsSync(join(pkgPath, cap.motion))) {
        fail('motions', `MOTION_MISSING: capability motion 文件缺失: ${cap.motion}（${cap.actionId}）`)
      } else {
        requiredFiles.push(posix(cap.motion))
      }
      // V2.1 sprite-sequence：帧序列文件逐一存在（QQ秀"动作即素材包"）
      if (cap.frames) {
        for (const rel of cap.frames) {
          if (!existsSync(join(pkgPath, rel))) {
            fail('motions', `FRAME_MISSING: capability 帧文件缺失: ${rel}（${cap.actionId}）`)
          } else {
            requiredFiles.push(posix(rel))
          }
        }
      }
      if (cap.expression) {
        const exprRel = `expressions/${cap.expression}.exp3.json`
        if (!existsSync(join(pkgPath, exprRel))) {
          fail('motions', `EXPRESSION_MISSING: capability expression 文件缺失: ${exprRel}（${cap.actionId}）`)
        } else {
          requiredFiles.push(exprRel)
        }
      }
    }
  }

  // ---- hash 校验（manifest.files sha256 比对）----
  if (manifest) {
    for (const [relRaw, expected] of Object.entries(manifest.files ?? {})) {
      const rel = posix(relRaw)
      const p = join(pkgPath, rel)
      if (!existsSync(p)) { fail('hashes', `HASH_MISSING: files 声明的文件不存在: ${rel}`); continue }
      const actual = createHash('sha256').update(readFileSync(p)).digest('hex')
      if (actual !== expected) {
        fail('hashes', `HASH_MISMATCH: hash 不匹配: ${rel}（期望 ${expected.slice(0, 12)}… 实际 ${actual.slice(0, 12)}…）`)
      }
    }
    const covered = new Set(Object.keys(manifest.files ?? {}).map(posix))
    for (const rel of requiredFiles) {
      if (!covered.has(rel)) warn(`manifest.files 未覆盖: ${rel}`)
    }
  }

  report.ok = report.errors.length === 0
  return report
}

// ---- CLI ----
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2)
  if (args.length === 0) {
    console.error('用法: node scripts/validate-avatar-package.mjs <角色包目录>...')
    process.exit(2)
  }
  const reports = args.map(validateAvatarPackage)
  for (const r of reports) console.log(JSON.stringify(r, null, 2))
  process.exitCode = reports.every((r) => r.ok) ? 0 : 1
}
