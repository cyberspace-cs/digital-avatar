import * as PIXI from 'pixi.js'
import { Live2DModel, MotionPriority } from 'pixi-live2d-display/cubism4'
import type { Mood } from '../types'
import { type QualityTier } from './perf'

// Live2DFactory 在 cubism4 模块内导出（不挂 window / Live2DModel.constructor），
// 这里动态 import 拿到模块命名空间，在运行时挂中间件。
type Live2DFactoryRuntime = {
  live2DModelMiddlewares?: any[]
  jsonToSettings?: any
  Live2DFactory?: Live2DFactoryRuntime
}

let cub4Namespace: Live2DFactoryRuntime | null = null
async function ensureCub4Ns(): Promise<Live2DFactoryRuntime | null> {
  if (cub4Namespace) return cub4Namespace
  try {
    const ns: any = await import('pixi-live2d-display/cubism4' as any)
    cub4Namespace = (ns.Live2DFactory ?? ns) as Live2DFactoryRuntime
    return cub4Namespace
  } catch (_e) {
    return null
  }
}


/**
 * 关键修复：pixi-live2d-display 库内部 path 解析走 ModelSettings.resolveURL(base, path)，
 * 如果直接把 Blob URL 写进 model3.json，库内 url.resolve 会把冒号吃掉变成 blob:http//，
 * 造成 XHR Status 0 失败。改成下列可靠策略：
 *  1. Worker 预取所有引用资源，封装 {相对路径 → Blob URL} Map 传回主线程；
 *  2. model3 对象本身保留原始相对路径，保证库 url.resolve(base, relPath) 行为正常；
 *  3. 在 Live2DFactory.live2DModelMiddlewares 的 jsonToSettings 之后插入一个中间件，
 *     针对新创建的 settings 实例挂一个 WeakMap 中的 blobMap：
 *     settings.resolveURL(p) 命中则返回 Blob URL，否则走原始 baseDir 解析。
 *     写法与库内置 ZipLoader.upload 的 `settings.resolveURL = function(...)` 完全一致，
 *     不触碰原型、不依赖模块命名空间导出、无全局状态泄漏。
 */

const settingsBlobMap = new WeakMap<any, Map<string, string>>()
let resolveUrlMwInstalled = false

async function installResolveUrlMiddleware() {
  if (resolveUrlMwInstalled) return
  const cub = await ensureCub4Ns()
  if (!cub) return
  const stack = cub.live2DModelMiddlewares
  if (!Array.isArray(stack)) return
  const jsonToSettings = cub.jsonToSettings
  if (jsonToSettings == null) return
  const idx = stack.indexOf(jsonToSettings)
  if (idx === -1) return
  stack.splice(idx + 1, 0, (context: any, next: () => any) => {
    const s = context.settings
    if (s) {
      const blobMap = settingsBlobMap.get(s)
      if (blobMap && blobMap.size) {
        const orig = s.resolveURL.bind(s) as (p: string) => string
        s.resolveURL = function (p: string): string {
          const hit = blobMap.get(p)
          return hit !== undefined ? hit : orig(p)
        }
      }
    }
    return next()
  })
  resolveUrlMwInstalled = true
}

/**
 * 动作 ID → Live2D motion 映射（Action 层：动作与角色解耦）。
 * 官方免费模型只有 Idle / TapBody 两组，TapBody 含多个动作，
 * index 越界时会在 play() 中自动回退，保证任何动作都有反馈。
 */
const ACTION_MOTIONS: Record<string, { group: string; index?: number }> = {
  poke: { group: 'TapBody', index: 0 },
  pat: { group: 'TapBody', index: 1 },
  pinch: { group: 'TapBody', index: 2 },
  wave: { group: 'TapBody', index: 3 },
  heart: { group: 'TapBody', index: 4 },
  hug: { group: 'TapBody', index: 5 },
  flick: { group: 'TapBody', index: 6 },
  // V1.2 小火人化：喂食/送花（复用 TapBody 动作，反馈由 App 层粒子+表情补足）
  feed: { group: 'TapBody', index: 2 },
  flower: { group: 'TapBody', index: 3 },
}

/** 状态 → 视觉规则（State 层）。Natori 用命名表情；Hiyori 无表情文件会静默跳过 */
const MOOD_RULES: Record<Mood, { expression?: string; speed: number }> = {
  neutral: { speed: 1 },
  happy: { expression: 'Smile', speed: 1.2 },
  low: { expression: 'Sad', speed: 0.6 },
  tired: { speed: 0.5 },
  angry: { expression: 'Angry', speed: 1.1 },
}

/**
 * 心情 → Cubism 标准参数覆盖层（State 层）。
 *
 * 不依赖 .exp3.json 表情文件（Hiyori 没有），直接驱动 Cubism4 通用标准参数，
 * 对所有模型生效。挂载在 internalModel 的 'beforeModelUpdate' 事件上：
 * 位于 动作/表情/物理 之后、coreModel.update() 之前，且被 saveParameters/loadParameters
 * 包裹 → 逐帧覆盖、不污染下一帧的动作基准。
 *
 * mode:
 *  - 'abs'：形状类参数（嘴形/眉毛/头角度），绝对覆盖
 *  - 'mul'：开合度类参数（睁眼），乘算——眨眼动画先写 EyeLOpen，乘算保留眨眼
 */
const MOOD_PARAMS: Record<Mood, Array<{ id: string; v: number; mode: 'abs' | 'mul' }>> = {
  neutral: [],
  happy: [
    { id: 'ParamMouthForm', v: 1, mode: 'abs' }, // 嘴角上扬
    { id: 'ParamEyeLSmile', v: 0.7, mode: 'abs' }, // 笑眼弯弯
    { id: 'ParamEyeRSmile', v: 0.7, mode: 'abs' },
    { id: 'ParamBrowLY', v: 0.25, mode: 'abs' }, // 眉毛微挑
    { id: 'ParamBrowRY', v: 0.25, mode: 'abs' },
  ],
  low: [
    { id: 'ParamMouthForm', v: -0.8, mode: 'abs' }, // 嘴角下垂
    { id: 'ParamBrowLForm', v: -1, mode: 'abs' }, // 困扰眉
    { id: 'ParamBrowRForm', v: -1, mode: 'abs' },
    { id: 'ParamEyeLOpen', v: 0.72, mode: 'mul' }, // 眼神黯淡
    { id: 'ParamEyeROpen', v: 0.72, mode: 'mul' },
    { id: 'ParamEyeBallY', v: -0.6, mode: 'abs' }, // 视线向下
    { id: 'ParamAngleY', v: -10, mode: 'abs' }, // 微微低头
  ],
  tired: [
    { id: 'ParamEyeLOpen', v: 0.45, mode: 'mul' }, // 半睁眼
    { id: 'ParamEyeROpen', v: 0.45, mode: 'mul' },
    { id: 'ParamMouthForm', v: -0.3, mode: 'abs' },
    { id: 'ParamBrowLY', v: -0.25, mode: 'abs' },
    { id: 'ParamBrowRY', v: -0.25, mode: 'abs' },
    { id: 'ParamAngleY', v: -6, mode: 'abs' },
  ],
  angry: [
    { id: 'ParamBrowLForm', v: 1, mode: 'abs' }, // 怒眉
    { id: 'ParamBrowRForm', v: 1, mode: 'abs' },
    { id: 'ParamBrowLY', v: -0.5, mode: 'abs' }, // 眉毛压低
    { id: 'ParamBrowRY', v: -0.5, mode: 'abs' },
    { id: 'ParamMouthForm', v: -0.8, mode: 'abs' },
    { id: 'ParamEyeLOpen', v: 0.85, mode: 'mul' },
    { id: 'ParamEyeROpen', v: 0.85, mode: 'mul' },
  ],
}

/** 参数平滑过渡时间常数（ms）：切心情时约 0.3s 内自然过渡，不跳变 */
const MOOD_PARAM_TAU = 120

/**
 * 穿搭风格（V1.3.1 肤色安全版）。
 *
 * V1.3.0 曾用 ColorMatrixFilter 全模型滤镜——肤色/脸也会跟着变色，被用户否决。
 * 新方案：**配饰（emoji 跟随头顶/侧边/脖子）+ 身后光环（径向渐变 tint）**，
 * 模型本身的任何像素都不改，肤色永远不会变。
 *
 * - `emoji`：配饰符号，空串表示无配饰
 * - `aura`：光环颜色（0xRRGGBB），0 表示无光环
 * - `anchor`：配饰挂点 head=头顶 / side=头侧 / neck=脖子
 * - `size`：配饰尺寸 = 角色真实绘制高度 × size（E2E 截图校准：🎀🧣 全尺寸会遮脸）
 * - `swatch`：UI 色板展示色（与光环同色系）
 */
export const OUTFIT_STYLES: Record<
  string,
  { label: string; emoji: string; aura: number; anchor: 'head' | 'side' | 'neck'; size: number; swatch: string }
> = {
  default: { label: '原生', emoji: '', aura: 0, anchor: 'head', size: 0.2, swatch: '#c9c9d6' },
  sakura: { label: '蝴蝶结', emoji: '🎀', aura: 0xff9ec4, anchor: 'side', size: 0.11, swatch: '#ff9ec4' },
  ocean: { label: '小蓝帽', emoji: '🧢', aura: 0x6cc3ff, anchor: 'head', size: 0.15, swatch: '#6cc3ff' },
  sunset: { label: '向日葵', emoji: '🌻', aura: 0xffb26b, anchor: 'side', size: 0.12, swatch: '#ffb26b' },
  night: { label: '小皇冠', emoji: '👑', aura: 0xa78bfa, anchor: 'head', size: 0.13, swatch: '#a78bfa' },
  mono: { label: '小围巾', emoji: '🧣', aura: 0xd8dee9, anchor: 'neck', size: 0.12, swatch: '#d8dee9' },
}

/** 径向渐变光环纹理（模块级共享，白色渐变 + tint 上色，只生成一次） */
let auraTexture: PIXI.Texture | null = null
function getAuraTexture(): PIXI.Texture {
  if (auraTexture) return auraTexture
  const c = document.createElement('canvas')
  c.width = c.height = 256
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(128, 128, 8, 128, 128, 128)
  g.addColorStop(0, 'rgba(255,255,255,0.5)')
  g.addColorStop(0.45, 'rgba(255,255,255,0.18)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 256, 256)
  auraTexture = PIXI.Texture.from(c)
  return auraTexture
}

export class AvatarSprite {
  model: Live2DModel | null = null
  home = { x: 0, y: 0 }
  target = { x: 0, y: 0 }
  mood: Mood = 'neutral'
  style = 'default'
  lerpSpeed = 0.06
  private _returning = false
  private _worker: Worker | null = null
  private _blobUrls: string[] = []
  /** 心情参数平滑状态：idx → {mode, cur}（abs 当前值 / mul 当前系数） */
  private _moodCur = new Map<number, { mode: 'abs' | 'mul'; cur: number }>()
  /** 按模型解析好的心情参数（跳过模型不存在的参数） */
  private _moodDefs = new Map<Mood, Array<{ idx: number; v: number; mode: 'abs' | 'mul' }>>()
  private _moodLastTs = 0
  /** 穿搭覆盖层：光环（模型身后）+ 配饰（模型身前），V1.3.1 肤色安全 */
  private _container: PIXI.Container | null = null
  private _aura: PIXI.Sprite | null = null
  private _acc: PIXI.Text | null = null
  /** 角色实际绘制包围盒（全局像素），由 drawable 顶点 + drawingMatrix 精确计算 */
  private _bounds = new PIXI.Rectangle()
  private _bframe = 0
  /** drawable 顶点范围（模型单位坐标）。Cubism 画布含大量空白，getBounds 是画布矩形而非角色，配饰定位必须用顶点 */
  private _verts = { minX: 0, maxX: 0, minY: 0, maxY: 0 }

  /** 扫描全部 drawable 顶点，求模型单位坐标下的真实绘制范围 */
  private _updateVertexBounds() {
    const core = (this.model as any)?.internalModel?.coreModel
    const get = core?.getDrawableVertexPositions?.bind(core) ?? core?.getDrawableVertices?.bind(core)
    if (!get) return
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    const n = core.getDrawableCount()
    for (let i = 0; i < n; i++) {
      const v = get(i)
      for (let j = 0; j < v.length; j += 2) {
        const x = v[j], y = v[j + 1]
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
    if (minX < maxX && minY < maxY) this._verts = { minX, maxX, minY, maxY }
  }

  /**
   * 收紧交互命中区到角色真实绘制范围（本地坐标静态矩形）。
   * 关键修复：Live2DModel 默认命中区 = 整个 moc 画布矩形，透明空白区会吞掉触控
   * （双端靠近时点空白命中的是对方 → 真机"拖不动小人/拖错人"）。
   * 用本地坐标矩形做 hitArea：不受 idle 动作顶点波动影响，命中稳定。
   */
  private _updateHitArea() {
    if (!this.model) return
    const im = (this.model as any).internalModel
    const ct = im?.centeringTransform
    if (!ct?.apply) return
    const v = this._verts
    const p1 = ct.apply(new PIXI.Point(v.minX, v.minY), new PIXI.Point())
    const p2 = ct.apply(new PIXI.Point(v.maxX, v.maxY), new PIXI.Point())
    const pad = Math.abs(p2.y - p1.y) * 0.04 // 触屏宽容边（约为角色高度 4%）
    this.model.hitArea = new PIXI.Rectangle(
      Math.min(p1.x, p2.x) - pad,
      Math.min(p1.y, p2.y) - pad,
      Math.abs(p2.x - p1.x) + pad * 2,
      Math.abs(p2.y - p1.y) + pad * 2,
    )
  }

  /** 角色真实绘制范围（全局像素），App 层触控命中兜底用 */
  realBounds(): PIXI.Rectangle | null {
    if (!this.model || !this.model.visible) return null
    return this._overlayBounds()
  }

  /**
   * 角色真实绘制范围（全局像素）。
   * 实测（Natori）：模型单位顶点经 centeringTransform（PPU 缩放 + 画布居中）得到
   * PIXI 本地像素，再 toGlobal 得全局像素——角色真实宽度仅约 124px，
   * 而 getBounds 给出的是 357px 的 moc 画布矩形（含大块空白），配饰会漂到空白处。
   * 注意：internalModel.drawingMatrix 是渲染器投影矩阵（NDC），不能用于定位。
   */
  private _overlayBounds(): PIXI.Rectangle {
    const im = (this.model as any)?.internalModel
    const ct = im?.centeringTransform as PIXI.Matrix | undefined
    if (ct?.apply) {
      const v = this._verts
      const p1 = ct.apply(new PIXI.Point(v.minX, v.minY), new PIXI.Point())
      const p2 = ct.apply(new PIXI.Point(v.maxX, v.maxY), new PIXI.Point())
      const g1 = this.model!.toGlobal(p1, new PIXI.Point(), true)
      const g2 = this.model!.toGlobal(p2, new PIXI.Point(), true)
      return new PIXI.Rectangle(
        Math.min(g1.x, g2.x),
        Math.min(g1.y, g2.y),
        Math.abs(g2.x - g1.x),
        Math.abs(g2.y - g1.y),
      )
    }
    return this.model!.getBounds(true)
  }

  async load(container: PIXI.Container, url: string, scale: number, tier: QualityTier = 'high') {
    await installResolveUrlMiddleware()

    // 预取分流 Worker：HTTP fetch + JSON 解析全在 Worker；主线程只做 WebGL 上传 + 渲染。
    let finalSource: string | object = url
    let worker: Worker | null = null
    try {
      // Vite 模块 worker：https://cn.vitejs.dev/guide/features.html#import-with-query-suffixes
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      const PrefetchWorkerModule = await import('./prefetch.worker.ts?worker')
      const PrefetchWorker = PrefetchWorkerModule.default as new () => Worker
      worker = new PrefetchWorker()
      const lod: 'hd' | 'sd' = tier === 'high' ? 'hd' : 'sd'
      const result = await new Promise<any>((resolve, reject) => {
        const to = setTimeout(() => reject(new Error('prefetch-worker-timeout')), 15000)
        if (!worker) return reject(new Error('no-worker'))
        worker.onmessage = (e) => {
          const r = e.data
          if (r?.kind === 'prefetched') {
            clearTimeout(to)
            console.info(
              `[prefetch] ${url} ${r.timings.fetchTotalMs}ms · ${r.timings.entries} entries (lod=${lod})`,
            )
            resolve(r)
          }
        }
        worker.onerror = (ev) => { clearTimeout(to); reject(new Error(ev.message)) }
        worker.postMessage({ kind: 'prefetch', modelUrl: url, lod })
      })
      // Worker 返回 model3 对象（保留原始相对路径）+ {relPath → blobUrl} Map
      this._blobUrls = result.blobUrls || []
      finalSource = result.model3 as object

      // 注册 {settings → blobMap} 关联：在 jsonToSettings 刚执行完时匹配 settings.json
      // （构造时 settings.json = context.source = result.model3，是同一个对象引用）
      const relMap = new Map<string, string>(Object.entries(result.blobMap || {}))
      if (relMap.size) {
        const cub = await ensureCub4Ns()
        const live2DStack = cub?.live2DModelMiddlewares
        const jsonToSettings = cub?.jsonToSettings
        if (Array.isArray(live2DStack) && jsonToSettings) {
          const jsonIdx = live2DStack.indexOf(jsonToSettings)
          if (jsonIdx !== -1) {
            // resolveURL mw 在 installResolveUrlMiddleware 后位于 stack[jsonIdx+1]，
            // 这里再 splice(jsonIdx+1) 插入注册器 → 它会执行在 resolveURL mw 之前
            live2DStack.splice(jsonIdx + 1, 0, (ctx: any, next: any) => {
              if (ctx.settings && ctx.settings.json === result.model3) {
                settingsBlobMap.set(ctx.settings, relMap)
              }
              return next()
            })
          }
        }
      }
      this._worker = worker
    } catch (err) {
      console.warn('[prefetch] 走直连（', (err as Error).message, '）')
      worker?.terminate()
      worker = null
      finalSource = url
    }

    this.model = (await Live2DModel.from(finalSource as any)) as Live2DModel
    this.model.scale.set(scale)
    this.model.anchor.set(0.5, 0.5)
    this.model.interactive = true
    container.addChild(this.model)
    this._container = container
    this._setupMoodParamDriver()
    this._updateVertexBounds()
    this._updateHitArea()
    this.applyStyle(this.style)
    return this.model
  }

  /**
   * 换装（V1.3）：销毁当前模型并加载新 model3。
   * 位置/可见性/心情由 App 层在 swap 完成后恢复。
   * 覆盖层（光环/配饰）随旧模型一并清理，加载完按当前 style 重建。
   */
  async swap(container: PIXI.Container, url: string, scale: number, tier: QualityTier = 'high') {
    if (this.model) {
      const internal = (this.model as any)?.internalModel as any
      internal?.off?.('beforeModelUpdate', this._applyMoodParams)
      this.model.destroy()
      this.model = null
    }
    this._clearOverlay()
    this._moodCur.clear()
    this._moodDefs.clear()
    this._worker?.terminate()
    this._worker = null
    this._blobUrls = []
    await this.load(container, url, scale, tier)
  }

  /**
   * 应用穿搭风格（V1.3.1 肤色安全）：配饰 emoji + 身后光环 tint。
   * 不再对模型加任何 filter——模型像素零改动，肤色不变。
   * 模型未加载时仅记录 style，load/swap 完成后自动生效。
   */
  applyStyle(styleId: string) {
    this.style = OUTFIT_STYLES[styleId] ? styleId : 'default'
    const preset = OUTFIT_STYLES[this.style]
    if (!this.model || !this._container) return

    // 光环：径向渐变 sprite，置于模型身后（stage 最底层）
    if (preset.aura) {
      if (!this._aura) {
        this._aura = new PIXI.Sprite(getAuraTexture())
        this._aura.anchor.set(0.5)
        this._container.addChildAt(this._aura, 0)
      }
      this._aura.tint = preset.aura
      this._aura.visible = this.model.visible
    } else {
      this._clearAura()
    }

    // 配饰：emoji Text，置于模型身前（跟随头顶/侧边/脖子）
    if (preset.emoji) {
      if (!this._acc || this._acc.text !== preset.emoji) {
        this._clearAcc()
        const t = new PIXI.Text(preset.emoji, { fontSize: 48 })
        t.resolution = 2
        // head 挂点让 emoji 大部分悬于定位点上方（"戴"在头顶）；side/neck 居中贴合
        t.anchor.set(0.5, preset.anchor === 'head' ? 0.72 : 0.5)
        this._acc = t
        this._container.addChild(t)
      }
      // 尺寸 = 角色真实绘制高度 × 每款 size（🎀🧣 等大字符全尺寸会遮脸，见 E2E 截图校准）
      const fs = Math.max(20, Math.min(72, this._overlayBounds().height * preset.size))
      if (this._acc.style.fontSize !== fs) this._acc.style.fontSize = fs
      this._acc.visible = true
    } else {
      this._clearAcc()
    }
    this._syncOverlay()
  }

  /** 每帧同步覆盖层：光环贴角色真实包围盒中心 + 呼吸脉冲；配饰按挂点跟随 + 轻微摇摆 */
  private _syncOverlay() {
    if (!this.model) return
    // 顶点范围每 15 帧重扫一次（遍历全部 drawable 顶点，逐帧算浪费）；包围盒每帧经 drawingMatrix 重映射
    if (this._bframe++ % 15 === 0) this._updateVertexBounds()
    const b = this._overlayBounds()
    this._bounds = b
    const cx = b.x + b.width / 2
    const t = performance.now()
    if (this._aura) {
      this._aura.visible = this.model.visible
      if (this._aura.visible) {
        this._aura.x = cx
        this._aura.y = b.y + b.height / 2
        const d = Math.max(b.width, b.height) * 1.5
        this._aura.scale.set(d / 256)
        // 轻微呼吸脉冲（±0.06）
        this._aura.alpha = 0.5 + Math.sin(t / 900) * 0.06
      }
    }
    if (this._acc) {
      this._acc.visible = this.model.visible
      if (this._acc.visible) {
        const preset = OUTFIT_STYLES[this.style]
        if (preset.anchor === 'head') {
          this._acc.x = cx
          this._acc.y = b.y + b.height * 0.1
        } else if (preset.anchor === 'side') {
          // 头侧：以身高比例定位（宽臂/双马尾模型的真实宽度会随动作波动，不能用全宽比例）
          this._acc.x = cx + b.height * 0.09
          this._acc.y = b.y + b.height * 0.11
        } else {
          this._acc.x = cx
          this._acc.y = b.y + b.height * 0.3
        }
        // 轻微摇摆跟随模型倾斜，营造"戴在身上"的感觉
        this._acc.rotation = this.model.rotation + Math.sin(t / 700) * 0.04
      }
    }
  }

  private _clearAura() {
    if (this._aura) {
      this._aura.parent?.removeChild(this._aura)
      this._aura.destroy()
      this._aura = null
    }
  }

  private _clearAcc() {
    if (this._acc) {
      this._acc.parent?.removeChild(this._acc)
      this._acc.destroy()
      this._acc = null
    }
  }

  private _clearOverlay() {
    this._clearAura()
    this._clearAcc()
  }

  /** 把 MOOD_PARAMS 解析成参数下标（跳过模型不存在的参数），挂 beforeModelUpdate 驱动 */
  private _setupMoodParamDriver() {
    const internal = (this.model as any)?.internalModel as any
    const core = internal?.coreModel
    if (!core?.setParameterValueByIndex || typeof internal.on !== 'function') return
    const count = core.getParameterCount()
    for (const [mood, defs] of Object.entries(MOOD_PARAMS) as [
      Mood,
      (typeof MOOD_PARAMS)[Mood],
    ][]) {
      this._moodDefs.set(
        mood,
        defs
          .map((d) => ({ ...d, idx: core.getParameterIndex(d.id) as number }))
          .filter((d) => d.idx >= 0 && d.idx < count),
      )
    }
    this._moodLastTs = performance.now()
    internal.on('beforeModelUpdate', this._applyMoodParams)
  }

  /** 每帧在 coreModel.update 前覆盖心情参数；向目标值指数平滑，切心情不跳变 */
  private _applyMoodParams = () => {
    const core = (this.model as any)?.internalModel?.coreModel
    if (!core) return
    const now = performance.now()
    const dt = Math.min(250, now - this._moodLastTs)
    this._moodLastTs = now
    const k = 1 - Math.exp(-dt / MOOD_PARAM_TAU)
    const defs = this._moodDefs.get(this.mood) ?? []
    const active = new Set(defs.map((d) => d.idx))
    for (const d of defs) {
      let entry = this._moodCur.get(d.idx)
      if (!entry) {
        entry = { mode: d.mode, cur: d.mode === 'mul' ? 1 : 0 }
        this._moodCur.set(d.idx, entry)
      }
      entry.mode = d.mode
      entry.cur += (d.v - entry.cur) * k
      if (d.mode === 'abs') {
        core.setParameterValueByIndex(d.idx, entry.cur)
      } else {
        // mul：乘算当前值（眨眼动画先写 EyeLOpen，乘算保留眨眼）
        core.setParameterValueByIndex(d.idx, core.getParameterValueByIndex(d.idx) * entry.cur)
      }
    }
    // 上一心情遗留参数 → 平滑回落默认值，收敛后移除
    for (const [idx, entry] of this._moodCur) {
      if (active.has(idx)) continue
      const fallback = entry.mode === 'mul' ? 1 : 0
      entry.cur += (fallback - entry.cur) * k
      if (entry.mode === 'abs') {
        core.setParameterValueByIndex(idx, entry.cur)
      } else {
        core.setParameterValueByIndex(idx, core.getParameterValueByIndex(idx) * entry.cur)
      }
      if (Math.abs(entry.cur - fallback) < 0.01) this._moodCur.delete(idx)
    }
  }

  get x() {
    return this.model?.x ?? 0
  }
  get y() {
    return this.model?.y ?? 0
  }
  setAnchor(x: number, y: number) {
    this.home.x = x
    this.home.y = y
    this.target.x = x
    this.target.y = y
    if (this.model) { this.model.x = x; this.model.y = y }
  }

  setMood(mood: Mood) {
    this.mood = mood
    const rule = MOOD_RULES[mood]
    if (!this.model) return
    const internalModel = (this.model as any).internalModel as any
    if (internalModel?.motionManager?.state) {
      internalModel.motionManager.state.speed = rule.speed
    }
    if (rule.expression) {
      const exprMgr = internalModel?.motionManager?.expressionManager
      const idx = exprMgr?.getExpressionIndex?.(rule.expression)
      if (typeof idx === 'number' && idx >= 0) void exprMgr.setExpression(idx)
    }
  }

  playAction(action: string) {
    if (!this.model) return
    const m = ACTION_MOTIONS[action] ?? ACTION_MOTIONS.poke
    // 官方免费模型 TapBody 动作数量有限（Hiyori 仅 1 个）：
    // 对 index 取模钳制到实际存在的动作数内，保证任何互动都必定播出一个动作，
    // 不同互动在动作多的模型（Natori x5）上仍有差异化表现。
    const internal = (this.model as any)?.internalModel
    const defs = internal?.motionManager?.definitions?.[m.group]
    const count = Array.isArray(defs) ? defs.length : 0
    if (count <= 0) {
      // 兜底：连 TapBody 都没有的模型就播 Idle
      this.model.motion('Idle', 0, MotionPriority.FORCE)
      return
    }
    this.model.motion(m.group, (m.index ?? 0) % count, MotionPriority.FORCE)
  }

  /** App.tsx 向后兼容：play() 是 playAction 的别名 */
  play(action: string) { return this.playAction(action) }

  walkTo(tx: number, ty: number) {
    this._returning = false
    this.target.x = tx
    this.target.y = ty
  }

  /** App.tsx 向后兼容：goHome() 是 returnHome() 的别名 */
  goHome() { this.returnHome() }

  /** 拖拽时取消自动回位（回位 lerp 会与拖拽目标互相拉扯） */
  cancelReturn() { this._returning = false }

  /** 接收方 mood === low 时的"负面反应"动作 */
  playSadReaction() {
    this.setMood('low')
    this.playAction('poke') // 没有专门的 Sad 动作，通用 poke 兜底
  }


  tick(delta?: number) {
    if (!this.model) return
    const d = (delta ?? 1) | 0
    if (this._returning) {
      this.model.x += (this.home.x - this.model.x) * this.lerpSpeed * d
      this.model.y += (this.home.y - this.model.y) * this.lerpSpeed * d
    } else {
      this.model.x += (this.target.x - this.model.x) * this.lerpSpeed * d
      this.model.y += (this.target.y - this.model.y) * this.lerpSpeed * d
    }
    this._syncOverlay()
  }

  /** App.tsx 兼容：PixiJS app.ticker.add() 不传参也能工作；setPosition = setAnchor 但不设 target */
  setPosition(x: number, y: number) {
    this.home.x = x
    this.home.y = y
    this.target.x = x
    this.target.y = y
    if (this.model) { this.model.x = x; this.model.y = y }
  }

  returnHome() {
    this._returning = true
    this.target.x = this.home.x
    this.target.y = this.home.y
  }

  destroy() {
    // 释放所有 Blob URL 引用（Blob URL 由 Worker 或主线程兜底创建，均由主线程 revoke）
    for (const u of this._blobUrls) {
      try { URL.revokeObjectURL(u) } catch (_e) { /* ignore */ }
    }
    this._blobUrls = []
    this._worker?.terminate()
    this._worker = null
    this._clearOverlay()
    this._container = null
    if (this.model) {
      const p = this.model.parent
      p?.removeChild(this.model)
      this.model.destroy({ children: true, texture: true, baseTexture: false })
      this.model = null
    }
  }
}
