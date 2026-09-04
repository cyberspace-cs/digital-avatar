/**
 * 真实换装（V1.4.2）：纹理级选择性重上色——服装整体换色，肤色/头发像素零改动。
 *
 * 历史：V1.3.0 ColorMatrixFilter 全模型滤镜（肤色一起变，否决）→
 *       V1.3.1 emoji 配饰+光环（用户反馈"位置不对，想要的是换装"）→
 *       V1.4.0 像素级重染（但保护矩形参数没接住 + Hiyori 腿部花斑 + Natori 头发误染）→
 *       V1.4.2 本版：修复矩形传参，新增"条件矩形"（发丝/布料按颜色细分）、
 *       每模型肤色阈值（Hiyori 皮肤与开衫同为奶油色 h25-45，阈值 42 会把腿部高光切成花斑）。
 *
 * 原理：Live2D 纹理集 = 脸/皮肤/头发/服装画在同一张 atlas。
 * 对配置的服装纹理逐像素判断：
 *  - 硬保护矩形（脸/发团/裸露皮肤）→ 一律保留原色
 *  - 条件保护矩形（发丝走廊）→ 仅保护深藏青发色（h≤265 且 v≤0.62），同矩形内的衣物照常染色
 *  - 皮肤保护掩码（暖色相 + 中低饱和 + 高明度）→ 保留原色
 *  - 其余像素（服装/袜/鞋）→ 色相混合到目标色系，保留 V 明暗层次
 */

export interface OutfitStyle {
  label: string
  /** 目标色相（0-360） */
  hue: number
  /** 饱和度倍率 */
  satMul: number
  /** 明度倍率 */
  valMul: number
  /** 色相混合强度（0=不变 1=完全变目标色相） */
  strength: number
  /** UI 色板色 */
  swatch: string
  /** 性别向色板（V1.5.0）：'m' 只在男模显示，'f' 只在女模显示，缺省 = 通用 */
  gender?: 'm' | 'f'
}

export const OUTFIT_STYLES: Record<string, OutfitStyle> = {
  default: { label: '原生', hue: 0, satMul: 1, valMul: 1, strength: 0, swatch: '#c9c9d6' },
  sakura: { label: '樱花粉', hue: 335, satMul: 1.05, valMul: 1, strength: 0.85, swatch: '#f59ec4', gender: 'f' },
  ocean: { label: '海盐蓝', hue: 208, satMul: 1, valMul: 1, strength: 0.85, swatch: '#6cc3ff', gender: 'f' },
  sunset: { label: '元气橙', hue: 22, satMul: 1.15, valMul: 1, strength: 0.85, swatch: '#ffb26b', gender: 'f' },
  night: { label: '暗夜紫', hue: 268, satMul: 0.95, valMul: 0.95, strength: 0.85, swatch: '#a78bfa', gender: 'f' },
  mono: { label: '胶片黑白', hue: 0, satMul: 0.06, valMul: 1, strength: 0, swatch: '#e8e8e8' },
  // V1.5.0 男色板：军绿 / 藏青 / 炭灰（女生界面不显示）
  olive: { label: '军绿', hue: 95, satMul: 0.9, valMul: 0.92, strength: 0.85, swatch: '#7d8f5a', gender: 'm' },
  navy: { label: '藏青', hue: 222, satMul: 1.1, valMul: 0.82, strength: 0.85, swatch: '#4a6b9c', gender: 'm' },
  charcoal: { label: '炭灰', hue: 220, satMul: 0.22, valMul: 0.88, strength: 0.85, swatch: '#5c616e', gender: 'm' },
}

/**
 * 每个模型的"服装纹理"（按 texture 文件名匹配）。
 * 基于 2048 atlas 实拍确认：
 *  - Hiyori：texture_01 = 开衫/裙/袜/鞋/腿/手臂（texture_00 是脸/发，不处理）
 *  - Natori：单 atlas 混排（服装 + 脸/手/腿/发），整张处理靠矩形+掩码保护
 *  - Haru：texture_01 = 西装裙裤/领带/发团（texture_00 是脸/发/手）
 */
const OUTFIT_MODEL_TEX: Record<string, string[]> = {
  hiyori: ['texture_01.png'],
  natori: ['texture_00.png'],
  haru: ['texture_01.png'],
  // V1.5.0 新增男模 Chitose：单 atlas 全混排（西装/领带/格裤/腿 + 脸/发/手同图）
  chitose: ['texture_00.png'],
}

/** 保护矩形（atlas 像素坐标，2048 原图基准；SD 半图按 img.width/2048 缩放） */
interface ProtectRect {
  rect: [number, number, number, number]
  /** true = 只保护深藏青发色（h≤265 且 v≤0.62），矩形内其余像素（浅紫布料等）照常染色 */
  hairOnly?: boolean
}

/**
 * 重染保护矩形。边界按 2048 atlas 实拍网格标定（离线校准工具逐区域验证）。
 * 原则：宁可漏染一小块衣物，也不能染头发/皮肤。
 */
const OUTFIT_PROTECT: Record<string, Record<string, ProtectRect[]>> = {
  // Hiyori texture_01：腿/手臂是裸露皮肤，且与开衫同为奶油色（掩码护不住红晕与高光）→ 硬矩形
  hiyori: {
    'texture_01.png': [
      { rect: [590, 0, 650, 690] }, // 双腿（含膝盖红晕）
      { rect: [1240, 0, 780, 350] }, // 上臂组
      { rect: [1240, 560, 780, 450] }, // 前臂/手/袖口（袖口与皮肤同色，一并保留=自然）
    ],
  },
  // Natori 单 atlas：发丝与衣物犬牙交错 → 脸/眼镜硬保护，发丝区用 hairOnly 按颜色细分
  natori: {
    'texture_00.png': [
      { rect: [0, 0, 250, 400] }, // 脸/耳/眼眉/嘴
      { rect: [250, 385, 110, 175] }, // 两副眼镜
      { rect: [250, 0, 810, 560], hairOnly: true }, // 主发区（内含嘴/眼镜边角，交由硬矩形兜底）
      { rect: [1030, 0, 115, 610], hairOnly: true }, // 左侧长发丝
      { rect: [1155, 0, 125, 610], hairOnly: true }, // 右侧长发丝
    ],
  },
  // Haru texture_01：右下角深紫发团
  haru: {
    'texture_01.png': [{ rect: [1655, 1500, 393, 548] }],
  },
}

/**
 * 白名单矩形（V1.4.3 起用于单 atlas 全混排的男模）：有此项时【只有矩形内的像素】参与重染。
 *
 * Chitose（V1.5.0，2048 atlas 实拍标定，坐标 ÷2 即预览图 1024 基准）：
 * 棕发与脸/手全在矩形外天然安全；红领带的暗部会撞通用唇色保护带 → SKIN_RULE.lip=false。
 */
const OUTFIT_ALLOW: Record<string, Record<string, [number, number, number, number][]>> = {
  chitose: {
    'texture_00.png': [
      [20, 1050, 550, 970], // 西装外套 + 领口 + 红领带
      [566, 1676, 420, 344], // 格纹长裤
      [596, 1540, 360, 110], // 鞋（浅色 + 深色两只）
      [1030, 1030, 580, 1000], // 右侧裤腿/袖件组
    ],
  },
}

/**
 * 每模型肤色掩码阈值。
 * Hiyori 皮肤/开衫同为奶油色（h25-45），阈值 42 恰好切在腿部高光 h43-44 上 → 粉色花斑；
 * 实测放宽到 h≤48、s≤0.5 后皮肤全保护、深色服装不受影响。
 * lip=false（Chitose）：红领带的暗部 (h≈355, s0.6, v0.7) 会撞上通用唇色保护带 → 整件衣服染花，
 * Chitose 的嘴是独立色块且不在服装白名单矩形内，关闭唇色带无副作用。
 */
const SKIN_RULE: Record<string, { warmHue: number; warmSat: number; lip: boolean }> = {
  hiyori: { warmHue: 48, warmSat: 0.5, lip: true },
  natori: { warmHue: 42, warmSat: 0.42, lip: true },
  haru: { warmHue: 42, warmSat: 0.42, lip: true },
  // chitose：红领带暗部 (h≈355) 会撞唇色保护带 → 关闭（嘴在矩形外，无副作用）
  chitose: { warmHue: 42, warmSat: 0.42, lip: false },
}

/** 从模型 URL 解析形象 id（…/models/<id>/<Name>.model3.json） */
export function avatarIdFromUrl(url: string): string {
  const m = /\/models\/([^/]+)\//.exec(url)
  return m ? m[1] : ''
}

/** 重染结果：replaced=替换的 blobMap 条目数；ownedUrls=本次新建的 blob URL（加载器销毁时需 revoke） */
export interface RecolorResult { replaced: number; ownedUrls: string[] }

/** 重染结果缓存：同形象同风格的纹理不重复计算（换形象/换装来回切时秒开） */
const recolorCache = new Map<string, string>()

/**
 * 对 blobMap 中该模型的服装纹理做重染，原位替换为新的 Blob URL。
 * 仅当 styleId 非法或为 default 时跳过。worker 直连兜底路径（无 blobMap）不受影响。
 */
export async function recolorOutfitTextures(
  blobMap: Record<string, string>,
  avatarId: string,
  styleId: string,
): Promise<RecolorResult> {
  const style = OUTFIT_STYLES[styleId]
  const texList = OUTFIT_MODEL_TEX[avatarId]
  const ownedUrls: string[] = []
  let replaced = 0
  if (!style || style.strength === 0 && style.satMul === 1 || !texList) return { replaced, ownedUrls }

  for (const [rel, url] of Object.entries(blobMap)) {
    const base = rel.slice(rel.lastIndexOf('/') + 1)
    const norm = base.replace(/\.sd\./i, '.')
    if (!texList.some((t) => norm === t)) continue
    const cacheKey = `${avatarId}|${styleId}|${base}`
    try {
      let outUrl = recolorCache.get(cacheKey) ?? null
      if (!outUrl) {
        const src = await fetch(url).then((r) => r.blob())
        const bmp = await createImageBitmap(src)
        const cvs = typeof OffscreenCanvas !== 'undefined'
          ? new OffscreenCanvas(bmp.width, bmp.height)
          : Object.assign(document.createElement('canvas'), { width: bmp.width, height: bmp.height })
        const ctx = cvs.getContext('2d', { willReadFrequently: true })!
        ctx.drawImage(bmp, 0, 0)
        bmp.close?.()
        const img = ctx.getImageData(0, 0, cvs.width, cvs.height)
        // 保护矩形/白名单矩形/肤色阈值换算到当前纹理尺寸（SD 半图按宽度比例缩放）
        const rects = OUTFIT_PROTECT[avatarId]?.[norm]
        const k = img.width / 2048
        const scaled = rects?.map(({ rect, hairOnly }) => ({
          rect: rect.map((n) => n * k) as [number, number, number, number],
          hairOnly,
        }))
        const allowRaw = OUTFIT_ALLOW[avatarId]?.[norm]
        const allow = allowRaw?.map((r) => r.map((n) => n * k) as [number, number, number, number])
        recolorPixels(img.data, img.width, style, scaled, avatarId, allow)
        ctx.putImageData(img, 0, 0)
        const out: Blob = await (cvs as OffscreenCanvas).convertToBlob({ type: 'image/png' })
        outUrl = URL.createObjectURL(out)
        recolorCache.set(cacheKey, outUrl)
        ownedUrls.push(outUrl)
      }
      blobMap[rel] = outUrl
      replaced++
    } catch (e) {
      console.warn('[outfit] 重染失败，该纹理保持原色', base, e)
    }
  }
  return { replaced, ownedUrls }
}

/**
 * 皮肤保护掩码：暖色相 且 中低饱和 且 偏高明度 → 保留原色。
 * 覆盖实测皮肤色：Hiyori 腿 #fbe8d8(H25 S.15 V.95) / Natori 脸手 #e2baa7(H15 S.25 V.75) /
 * Haru 手 #e7b4a5(H15 S.25 V.75)；同时保护嘴唇等暖色中饱和区（H≥340, S≤0.65, V 0.45-0.8），
 * 不误伤：Haru 深红缝线(H345 V.25)明度不足保持染色，深棕鞋(V<0.5)保持染色。
 */
function isSkin(h: number, s: number, v: number, avatarId: string): boolean {
  const rule = SKIN_RULE[avatarId] ?? { warmHue: 42, warmSat: 0.42, lip: true }
  const warm = h <= rule.warmHue || h >= 335
  if (warm && s <= rule.warmSat && v >= 0.5) return true
  // 嘴唇/腮红高饱和带（Mark 关闭：红色卫衣暗部会撞带）
  if (rule.lip && (h >= 340 || h <= 15) && s >= 0.3 && s <= 0.65 && v >= 0.45 && v <= 0.8) return true
  return false
}

function recolorPixels(
  d: Uint8ClampedArray,
  w: number,
  st: OutfitStyle,
  rects?: { rect: [number, number, number, number]; hairOnly?: boolean }[],
  avatarId = '',
  allow?: [number, number, number, number][],
) {
  const strength = st.strength
  const target = st.hue
  // 饱和度垫底：深色低饱和面料（Natori 西装 S0.13-0.38 V0.25-0.38）只转色相会脏脏不显色，
  // 补一档饱和度让目标色系看得出来；线稿（V<0.15）保持深色不染，保留轮廓
  const satAdd = strength > 0 ? 0.32 : 0
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue
    const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), df = mx - mn
    let h = 0
    if (df > 0) {
      if (mx === r) h = ((g - b) / df + 6) % 6
      else if (mx === g) h = (b - r) / df + 2
      else h = (r - g) / df + 4
      h *= 60
    }
    const s = mx ? df / mx : 0
    const v = mx
    if (v < 0.15) continue // 线稿/最深阴影不染
    if (s < 0.06 && v > 0.9) continue // 纯白高光/白蕾丝不染（否则在深色袜/裙上出现粉色斑点）
    // 保护矩形：硬矩形一律保留；hairOnly 矩形仅保留深藏青发色，其余（浅紫布料）照常染色
    if (allow) {
      const p = i >> 2
      const px = p % w
      const py = (p / w) | 0
      let hit = false
      for (const [ax, ay, aw, ah] of allow) {
        if (px >= ax && px < ax + aw && py >= ay && py < ay + ah) { hit = true; break }
      }
      if (!hit) continue
    }
    if (rects) {
      const p = i >> 2
      const px = p % w
      const py = (p / w) | 0
      let prot = false
      for (const { rect: [rx, ry, rw, rh], hairOnly } of rects) {
        if (px >= rx && px < rx + rw && py >= ry && py < ry + rh) {
          if (!hairOnly) { prot = true; break }
          // 发丝色（深藏青 h≤265 或 暖棕 h≤48）→ 保护；不 break，硬矩形仍可否决。
          // Natori 前发底层的棕色发丝 (h20-45 s0.05-0.6) 与主发区内的皮肤/嘴同暖色，
          // 该矩形内没有需要染色的暖色衣物，放宽不会误伤。
          if ((h <= 265 && v <= 0.62) || (h <= 48 && s >= 0.05)) prot = true
        }
      }
      if (prot) continue
    }
    if (isSkin(h, s, v, avatarId)) continue
    // 色相沿最短路径混合到目标
    const dh = ((target - h + 540) % 360) - 180
    const nh = (h + dh * strength + 360) % 360
    const ns = Math.min(1, s * st.satMul + satAdd)
    const nv = Math.min(1, v * st.valMul)
    // HSV → RGB
    const c = nv * ns
    const x2 = c * (1 - Math.abs(((nh / 60) % 2) - 1))
    const m = nv - c
    let nr = 0, ng = 0, nb = 0
    const seg = Math.floor(nh / 60) % 6
    if (seg === 0) { nr = c; ng = x2 }
    else if (seg === 1) { nr = x2; ng = c }
    else if (seg === 2) { ng = c; nb = x2 }
    else if (seg === 3) { ng = x2; nb = c }
    else if (seg === 4) { nr = x2; nb = c }
    else { nr = c; nb = x2 }
    d[i] = Math.round((nr + m) * 255)
    d[i + 1] = Math.round((ng + m) * 255)
    d[i + 2] = Math.round((nb + m) * 255)
  }
}
