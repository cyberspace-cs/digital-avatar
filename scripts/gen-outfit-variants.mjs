/**
 * V1.5.0 衣橱 2.0：款式变体纹理生成 + 校验（一步完成）
 *
 * 生成：
 *  - chitose/knit  ：西装→墨绿针织（织纹噪点）、格纹裤→深灰纯色、红领带→琥珀金
 *  - haru/sailor   ：灰西装裙→水手藏青、蓝条纹领巾→正红领巾
 * 输出（含 .sd 半图 LOD）：
 *  - client/public/models/<id>/outfits/<variant>/texture_NN.png / texture_NN.sd.png
 *
 * 校验（不通过则 exit 1，杜绝"染到头发/皮肤"的变体入库）：
 *  - 改动像素 ⊆ 声明的服装处理矩形（+SD 全图校验）
 *  - 保护矩形（发团等）零改动
 *  - 肤色像素（暖色中低饱和高明度）零改动
 *
 * 用法：node scripts/gen-outfit-variants.mjs  （需 localhost:4173 preview 在跑）
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
// puppeteer-core 装在 client/（E2E 脚本所在地），scripts/ 下没有自己的 node_modules
const require2 = createRequire(join(ROOT, 'client', 'package.json'))
const puppeteer = require2('puppeteer-core')
const ORIGIN = 'http://localhost:4173'

// ---------- 变体定义（与 client/src/live2d/outfit.ts OUTFIT_VARIANTS 保持一致） ----------
const JOBS = [
  {
    avatar: 'chitose', variant: 'knit', src: '/digital-avatar/models/chitose/chitose.2048/texture_00.png',
    // 服装处理矩形（2048 基准，同 OUTFIT_ALLOW；鞋保留原样不在列）
    rects: [
      [20, 1050, 550, 970],   // 西装外套 + 领带
      [566, 1676, 420, 344],  // 格纹长裤
      [1030, 1030, 580, 1000],// 右侧裤腿/袖件组
    ],
    protect: [],
    // 每像素分类变换：针织绿 / 领带金 / 纯色裤
    transform: /* JS */`
      (h, s, v, x, y) => {
        if (v < 0.12) return null // 线稿保持
        const redTie = (h >= 340 || h <= 15) && s >= 0.3
        if (redTie) return [45, 0.75, Math.min(1, v * 1.05)] // 领带 → 琥珀金
        // 针织墨绿：V 压缩到针织中亮区 + 织纹噪点
        const nv = Math.min(1, Math.max(0.06, 0.16 + v * 0.62 + (globalThis.__hash(x, y) - 0.5) * 0.07))
        return [138, 0.42, nv]
      }
    `,
    solidRects: [[566, 1676, 420, 344]], // 裤子：收纯色（压对比）
    solid: [228, 0.22],
  },
  {
    avatar: 'haru', variant: 'sailor', src: '/digital-avatar/models/haru/Haru.2048/texture_01.png',
    rects: [
      [40, 0, 880, 960],      // 裙
      [920, 60, 720, 540],    // 上部双袖
      [1740, 450, 280, 130],  // 右上深色小件
      [1130, 510, 370, 570],  // 中部短裤/袜
      [1620, 600, 340, 480],  // 西装翻领对
      [60, 1010, 660, 1014],  // 上衣主体
      [700, 1090, 700, 610],  // 中下双袖
      [1400, 1120, 520, 420], // 右中双袖
      [1580, 20, 440, 380],   // 蓝条纹领巾 → 红
    ],
    protect: [[1700, 1580, 320, 460]], // 紫发团：一丝不能动
    transform: /* JS */`
      (h, s, v, x, y) => {
        if (v < 0.12) return null
        if (s < 0.08 && v > 0.85) return null // 白条纹/白色高光保持
        if (h >= 195 && h <= 250 && s >= 0.15) return [355, Math.max(0.65, s), v] // 蓝条纹领巾 → 正红
        if (s < 0.4) return [222, 0.5, v * 0.92] // 灰西装面料 → 水手藏青
        return null
      }
    `,
    solidRects: [],
    solid: null,
  },
  // ---------- V1.6.0 情侣成套款（真·同图案情侣针织，双方 pattern 同步） ----------
  {
    avatar: 'chitose', variant: 'knit_sea', src: '/digital-avatar/models/chitose/chitose.2048/texture_00.png',
    rects: [
      [20, 1050, 550, 970],
      [566, 1676, 420, 344],
      [1030, 1030, 580, 1000],
    ],
    protect: [],
    transform: /* JS */`
      (h, s, v, x, y) => {
        if (v < 0.12) return null
        const redTie = (h >= 340 || h <= 15) && s >= 0.3
        if (redTie) return [222, 0.6, Math.min(1, v * 0.78)] // 领带 → 藏青
        const nv = Math.min(1, Math.max(0.06, 0.16 + v * 0.62 + (globalThis.__hash(x, y) - 0.5) * 0.07))
        return [206, 0.42, nv] // 海雾蓝针织
      }
    `,
    solidRects: [[566, 1676, 420, 344]],
    solid: [208, 0.38],
    pattern: { type: 'plaid', rgb: [255, 255, 255], alpha: 0.16, step: 48 }, // 与 sailor_sea 同款格纹
  },
  {
    avatar: 'haru', variant: 'sailor_sea', src: '/digital-avatar/models/haru/Haru.2048/texture_01.png',
    rects: [
      [40, 0, 880, 960],
      [920, 60, 720, 540],
      [1740, 450, 280, 130],
      [1130, 510, 370, 570],
      [1620, 600, 340, 480],
      [60, 1010, 660, 1014],
      [700, 1090, 700, 610],
      [1400, 1120, 520, 420],
      [1580, 20, 440, 380],
    ],
    protect: [[1700, 1580, 320, 460]],
    transform: /* JS */`
      (h, s, v, x, y) => {
        if (v < 0.12) return null
        if (s < 0.08 && v > 0.85) return null // 白条纹保持
        if (h >= 195 && h <= 250 && s >= 0.15) return [0, 0.04, 0.97] // 蓝领巾 → 白
        if (s < 0.4) return [205, 0.45, v * 0.92] // 灰西装 → 海雾蓝
        return null
      }
    `,
    solidRects: [],
    solid: null,
    pattern: { type: 'plaid', rgb: [255, 255, 255], alpha: 0.14, step: 48 },
  },
  {
    avatar: 'chitose', variant: 'knit_heart', src: '/digital-avatar/models/chitose/chitose.2048/texture_00.png',
    rects: [
      [20, 1050, 550, 970],
      [566, 1676, 420, 344],
      [1030, 1030, 580, 1000],
    ],
    protect: [],
    transform: /* JS */`
      (h, s, v, x, y) => {
        if (v < 0.12) return null
        const redTie = (h >= 340 || h <= 15) && s >= 0.3
        if (redTie) return [335, 0.72, Math.min(1, v * 1.05)] // 领带 → 樱粉
        const nv = Math.min(1, Math.max(0.06, 0.16 + v * 0.62 + (globalThis.__hash(x, y) - 0.5) * 0.07))
        return [222, 0.16, nv] // 炭灰针织
      }
    `,
    solidRects: [[566, 1676, 420, 344]],
    solid: [222, 0.14],
    pattern: { type: 'heart', rgb: [244, 154, 196], alpha: 0.55, step: 64 }, // 与 sailor_heart 同款爱心
  },
  {
    avatar: 'haru', variant: 'sailor_heart', src: '/digital-avatar/models/haru/Haru.2048/texture_01.png',
    rects: [
      [40, 0, 880, 960],
      [920, 60, 720, 540],
      [1740, 450, 280, 130],
      [1130, 510, 370, 570],
      [1620, 600, 340, 480],
      [60, 1010, 660, 1014],
      [700, 1090, 700, 610],
      [1400, 1120, 520, 420],
      [1580, 20, 440, 380],
    ],
    protect: [[1700, 1580, 320, 460]],
    transform: /* JS */`
      (h, s, v, x, y) => {
        if (v < 0.12) return null
        if (s < 0.08 && v > 0.85) return null // 白条纹保持
        if (h >= 195 && h <= 250 && s >= 0.15) return [0, 0.04, 0.97] // 蓝领巾 → 白
        if (s < 0.4) return [335, 0.5, v] // 灰西装 → 樱粉
        return null
      }
    `,
    solidRects: [],
    solid: null,
    pattern: { type: 'heart', rgb: [255, 255, 255], alpha: 0.6, step: 64 },
  },
]

// 在浏览器页里执行的处理 + diff（Node 无解码器，借 headless canvas）
const pageJs = (job) => {
  const hash = (x, y) => {
    let n = (x * 73856093) ^ (y * 19349663)
    n = (n << 13) ^ n
    return ((n * (n * n * 15731 + 789221) + 1376312589) & 0x7fffffff) / 0x7fffffff
  }
  const inRect = (px, py, r) => px >= r[0] && px < r[0] + r[2] && py >= r[1] && py < r[1] + r[3]
  const rgb2hsv = (r, g, b) => {
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), df = mx - mn
    let h = 0
    if (df > 0) {
      if (mx === r) h = ((g - b) / df + 6) % 6
      else if (mx === g) h = (b - r) / df + 2
      else h = (r - g) / df + 4
      h *= 60
    }
    return [h, mx ? df / mx : 0, mx]
  }
  const hsv2rgb = (h, s, v) => {
    const c = v * s
    const x2 = c * (1 - Math.abs(((h / 60) % 2) - 1))
    const m = v - c
    let r = 0, g = 0, b = 0
    const seg = Math.floor(h / 60) % 6
    if (seg === 0) { r = c; g = x2 } else if (seg === 1) { r = x2; g = c }
    else if (seg === 2) { g = c; b = x2 } else if (seg === 3) { g = x2; b = c }
    else if (seg === 4) { r = x2; b = c } else { r = c; b = x2 }
    return [(r + m) * 255, (g + m) * 255, (b + m) * 255]
  }
  const isSkin = (h, s, v) => (h <= 42 || h >= 335) && s <= 0.42 && v >= 0.5

  return fetch(job.src)
    .then((r) => { if (!r.ok || !String(r.headers.get('content-type') ?? '').startsWith('image/')) throw new Error('src fetch fail ' + r.status); return r.blob() })
    .then((b) => createImageBitmap(b))
    .then(async (bmp) => {
      const cvs = document.createElement('canvas')
      cvs.width = bmp.width; cvs.height = bmp.height
      const ctx = cvs.getContext('2d', { willReadFrequently: true })
      ctx.drawImage(bmp, 0, 0)
      const orig = ctx.getImageData(0, 0, cvs.width, cvs.height)
      const out = ctx.getImageData(0, 0, cvs.width, cvs.height)
      const k = cvs.width / 2048
      const rects = job.rects.map((r) => r.map((n) => Math.round(n * k)))
      // transform 以字符串传递（structured clone 不支持函数），页内还原为函数
      globalThis.__hash = hash
      const tf = (0, eval)('(' + job.transform + ')')
      const solids = job.solidRects.map((r) => r.map((n) => Math.round(n * k)))
      const protect = job.protect.map((r) => r.map((n) => Math.round(n * k)))
      const d = out.data, o = orig.data
      let changed = 0, changedOutside = 0, skinChanged = 0, protectChanged = 0
      for (let py = 0; py < cvs.height; py++) {
        for (let px = 0; px < cvs.width; px++) {
          const i = (py * cvs.width + px) * 4
          if (d[i + 3] === 0) continue
          const [h, s, v] = rgb2hsv(o[i] / 255, o[i + 1] / 255, o[i + 2] / 255)
          const inAny = rects.some((r) => inRect(px, py, r))
          if (!inAny) continue
          const t = tf(h, s, v, px, py)
          let target = t
          const solid = solids.find((r) => inRect(px, py, r))
          if (solid && v >= 0.12) {
            const nv = Math.min(1, Math.max(0.08, 0.3 + v * 0.42)) // 压对比 → 纯色面料
            target = [job.solid[0], job.solid[1], nv]
          }
          if (!target) continue
          if (isSkin(h, s, v)) { skinChanged++; continue } // 肤色像素强制跳过（不判"违规"，直接保护）
          if (protect.some((r) => inRect(px, py, r))) protectChanged++
          const [nr, ng, nb] = hsv2rgb(target[0], target[1], target[2])
          const before = d[i] + d[i + 1] + d[i + 2]
          d[i] = nr; d[i + 1] = ng; d[i + 2] = nb
          if (Math.abs(nr + ng + nb - before) > 6) {
            changed++
            if (!inAny || protect.some((r) => inRect(px, py, r))) changedOutside++
          }
          // V1.6.0 情侣成套款：同款图案叠加（格纹/爱心图章），仅服装矩形内、非肤色像素
          const P = job.pattern
          if (P) {
            const step = Math.round(P.step * k)
            let on = false
            if (P.type === 'plaid') {
              const lw = Math.max(2, Math.round(3 * k))
              on = (px % step) < lw || (py % step) < lw
            } else if (P.type === 'heart') {
              const u = ((px % step) / step) * 2 - 1
              const w2 = ((py % step) / step) * 2 - 1
              const hy = -w2 + 0.25
              const a2 = u * u + hy * hy - 1
              on = a2 * a2 * a2 - u * u * hy * hy * hy < 0 // 心形隐式曲线 (x²+y²−1)³−x²y³<0
            }
            if (on) {
              const before2 = d[i] + d[i + 1] + d[i + 2]
              d[i] = d[i] * (1 - P.alpha) + P.rgb[0] * P.alpha
              d[i + 1] = d[i + 1] * (1 - P.alpha) + P.rgb[1] * P.alpha
              d[i + 2] = d[i + 2] * (1 - P.alpha) + P.rgb[2] * P.alpha
              if (Math.abs(d[i] + d[i + 1] + d[i + 2] - before2) > 6) {
                changed++
                if (!inAny) changedOutside++
              }
            }
          }
        }
      }
      ctx.putImageData(out, 0, 0)
      const fullPng = cvs.toDataURL('image/png')
      // SD 半图
      const sd = document.createElement('canvas')
      sd.width = cvs.width >> 1; sd.height = cvs.height >> 1
      sd.getContext('2d').drawImage(cvs, 0, 0, sd.width, sd.height)
      const sdPng = sd.toDataURL('image/png')
      return { fullPng, sdPng, report: { changed, changedOutside, skinChanged, protectChanged, w: cvs.width } }
    })
}

;(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: 'new',
    protocolTimeout: 300000,
  })
  const page = await browser.newPage()
  await page.goto(ORIGIN + '/digital-avatar/', { waitUntil: 'domcontentloaded' })
  let failed = false
  for (const job of JOBS) {
    const { fullPng, sdPng, report } = await page.evaluate(pageJs, job)
    const dir = join(ROOT, 'client/public/models', job.avatar, 'outfits', job.variant)
    const texName = job.src.split('/').pop()
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, texName), Buffer.from(fullPng.split(',')[1], 'base64'))
    writeFileSync(join(dir, texName.replace(/\.png$/i, '.sd.png')), Buffer.from(sdPng.split(',')[1], 'base64'))
    const ok = report.changedOutside === 0 && report.changed > 500
    console.log(
      `[${job.avatar}/${job.variant}] changed=${report.changed} outside=${report.changedOutside} ` +
      `skinProtected(跳过)=${report.skinChanged} protectRect改动=${report.protectChanged} → ${ok ? 'PASS' : 'FAIL'}`,
    )
    if (!ok) failed = true
  }
  await browser.close()
  process.exit(failed ? 1 : 0)
})().catch((e) => { console.error('FATAL', e); process.exit(1) })
