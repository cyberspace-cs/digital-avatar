import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import * as PIXI from 'pixi.js'
import './pixi-setup'
import { AvatarSprite, OUTFIT_STYLES, OUTFIT_VARIANTS } from './live2d/avatar'
import { COUPLE_THEMES, COUPLE_THEME_ORDER, matchCoupleTheme } from './live2d/couple'
import { AVATAR_LIBRARY, AVATAR_LABELS, AVATAR_GENDER, AVATAR_HALF_BODY, MODEL_URLS, DEFAULT_AVATAR } from './live2d/models'
import { PerfGovernor } from './live2d/perf'
import type { QualityTier } from './live2d/perf'
import { api } from './api'
import { connectSocket, emit, getSocket, isSocketConnected } from './socket'
// V2.0 Task 3：动作注册表（降级链）+ 互动发送用例（socket → ack 超时 → REST 兜底）
import { resolveAction, legacyCapabilities, actionLabel as labelOf, actionBubble, MENU_ACTIONS } from './actions/registry'
import type { ActionPlan } from './actions/registry'
import { createSendInteraction } from './application/sendInteraction'
// V2.0 Task 8：弱网 outbox（Socket+REST 全失败 → localStorage 暂存 → 重连按 eventId 幂等回放）
import { createOutbox, localStorageOutboxStorage } from './application/outbox'
// V2.0 Task 6：双人编排（服务端状态机 + 五阶段时间轴执行器）+ 回忆时间线
import { createChoreography, CHOREOGRAPHY_ACTIONS } from './actions/choreographies'
import type { ChoreographyPhase, ChoreographyPlan, ChoreographyState } from '@digital-avatar/shared'
import { runChoreography } from './runtime/choreography-runner'
import { LegacyPixiAdapter, legacyManifest } from './runtime/adapters/legacy-pixi'
import { prepareSharedMoment, advanceMoment } from './application/sharedMoment'
import MemoryTimeline from './features/memories/MemoryTimeline'
// V2.0 Task 4：舞台布局规则单一事实源（homeYFor 移植到 scene-coordinator）
import { homeYFor as sceneHomeYFor } from './runtime/scene-coordinator'
import type { BondMeta, InteractionEvent, Mood, User, Visibility } from './types'

// V1.3.2 形象库配置化：见 live2d/models.ts，新增形象只改 models.ts 一处
const MODEL_SCALE = 0.12
// V1.6.2 home y（缺腿根治）：V2.0 Task 4 起规则统一收敛到 runtime/scene-coordinator（单一事实源）
// 全身像脚底贴 Dock 上沿（预留 96px）；半身像（chitose）按胸像构图——截断边压出屏幕底 10%
const homeYFor = (avatarKey: string, h: number) =>
  sceneHomeYFor(AVATAR_HALF_BODY[avatarKey] === true, h, window.innerHeight)
// 形象按钮 emoji（衣橱芯片用）
const AVATAR_EMOJI: Record<string, string> = { hiyori: '🌸', haru: '📚', natori: '🌙', chitose: '🧥' }

type MenuPos = { x: number; y: number; target: 'me' | 'partner' } | null
type Tab = 'companion' | 'memories' | 'records' | 'me'

const MOOD_LABELS: Record<Mood, string> = {
  neutral: '普通',
  happy: '开心',
  low: '低落',
  tired: '疲惫',
  angry: '生气',
}
const VIS_LABELS: Record<Visibility, string> = {
  public: '公开可见',
  'each-time': '每次选择',
  'discover-after': '互动后发现',
}
// 互动动作清单（长按菜单顺序）——标签/气泡文案统一在 actions/registry
const ACTIONS = MENU_ACTIONS
// 互动 Dock（V1.2 小火人化）
const DOCK = [
  { id: 'feed', emoji: '🧁' },
  { id: 'pat', emoji: '🫳' },
  { id: 'poke', emoji: '👉' },
  { id: 'hug', emoji: '🤗' },
  { id: 'flower', emoji: '💐' },
]
// V2.0 Task 6：共同时刻应用层端口（REST 权威推进，非法转移由服务端拒绝）
const momentPorts = { createMoment: api.createMoment, transitionMoment: api.transitionMoment }
// V2.0 Task 8：离线发件箱（模块级单例，跨刷新持久）。flushOne 走 REST：
// 有事件=送达；duplicate=重连重放被服务端 eventId 幂等吞掉，也算送达；其余失败保留
const outbox = createOutbox({
  storage: localStorageOutboxStorage(),
  flushOne: async (entry) => {
    const r = await api.interact(entry.payload)
    if (r.duplicate) return { duplicate: true }
    return !!r.event
  },
})
// 双人编排动作 emoji（长按菜单「双人时刻」区）
const CHOREO_EMOJI: Record<string, string> = { hug: '🤗', handhold: '🤝', 'shoulder-lean': '🫂' }
// V2.0 Task 6：任务页升级为回忆时间线（等级/任务 UI 移除，服务端只读兼容不动）
const TABS: { id: Tab; emoji: string; label: string }[] = [
  { id: 'companion', emoji: '🏠', label: '陪伴' },
  { id: 'memories', emoji: '💛', label: '回忆' },
  { id: 'records', emoji: '💞', label: '记录' },
  { id: 'me', emoji: '⚙️', label: '我的' },
]

export default function App() {
  const canvasHost = useRef<HTMLDivElement>(null)
  const appRef = useRef<PIXI.Application | null>(null)
  const meSprite = useRef<AvatarSprite | null>(null)
  const partnerSprite = useRef<AvatarSprite | null>(null)
  const [theme, setTheme] = useState<'v1' | 'v2'>(
    () => (localStorage.getItem('da_theme') as 'v1' | 'v2') ?? 'v1',
  )

  // 主题切换（v1 初版 / v2 aurora-glass，双主题并存可对比）
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('da_theme', theme)
  }, [theme])

  const [me, setMe] = useState<User | null>(null)
  const [partner, setPartner] = useState<User | null>(null)
  const [nickname, setNickname] = useState('')
  const [mood, setMood] = useState<Mood>('neutral')
  const [visibility, setVisibility] = useState<Visibility>('public')
  const [menu, setMenu] = useState<MenuPos>(null)
  const [events, setEvents] = useState<InteractionEvent[]>([])
  const [showMoodPicker, setShowMoodPicker] = useState(false)
  const [bubble, setBubble] = useState<{ who: 'me' | 'partner'; text: string } | null>(null)
  const [hearts, setHearts] = useState<{ id: number; x: number; y: number; emoji: string }[]>([])
  const [partnerOnline, setPartnerOnline] = useState(false)
  const [inviteLink, setInviteLink] = useState('')
  const [toast, setToast] = useState('')
  const [partnerMood, setPartnerMood] = useState<Mood | null>(null)
  // V2.0 Task 6：Tab 壳（任务页已升级为回忆时间线，火花/等级组件已移除）
  const [tab, setTab] = useState<Tab>('companion')
  const [bond, setBond] = useState<BondMeta | null>(null)
  // V2.0 Task 7 解绑：两步确认（第一步只把按钮换成确认组，误触不生效）
  const [confirmUnbind, setConfirmUnbind] = useState(false)
  // V2.0 Task 8 离线发件箱：待发条数（顶栏小条提示"恢复后自动送达"）
  const [outboxCount, setOutboxCount] = useState(() => outbox.pendingCount())
  // V1.3 换装：自己的穿搭风格（形象跟 me.avatar 走）
  const [myStyle, setMyStyle] = useState('default')
  // V1.5.0 衣橱 2.0：自己的款式（'base' = 原生；款式属于形象，换形象时回落 base）
  const [myOutfit, setMyOutfit] = useState('base')
  // V1.6.0 情侣衣橱：对方的 style/outfit（徽章匹配 + couple_applied 应用）
  const [partnerLook, setPartnerLook] = useState<{ style: string; outfit: string }>({ style: 'default', outfit: 'base' })
  // 首个模型加载中：给用户"分身登场中"反馈，而不是对着空白等
  const [booting, setBooting] = useState(true)
  // V2.0 Task 8：首选形象与兜底形象都加载失败 → 安全占位态（明确提示 + 重试按钮，不白屏）
  const [stageError, setStageError] = useState(false)
  // V1.4.3 桌宠模式：藏起整个 App 壳，只留一只可拖拽的小人 + 迷你互动坞
  const [petMode, setPetMode] = useState(() => localStorage.getItem('da_petmode') === '1')
  const togglePetMode = useCallback(() => {
    setPetMode((v) => {
      localStorage.setItem('da_petmode', v ? '0' : '1')
      return !v
    })
  }, [])

  // V1.6.1 桌宠 idle 轮换（借鉴 Codex 桌宠/Miku 桌宠：空闲定时换待机动作，防"摆大字挂机"）；
  // 退出桌宠或卸载时停表，避免后台空转
  useEffect(() => {
    if (petMode) {
      meSprite.current?.startIdleLoop()
      partnerSprite.current?.startIdleLoop()
    } else {
      meSprite.current?.stopIdleLoop()
      partnerSprite.current?.stopIdleLoop()
    }
    return () => {
      meSprite.current?.stopIdleLoop()
      partnerSprite.current?.stopIdleLoop()
    }
  }, [petMode])

  // 对方 Live2D 模型懒加载器：未绑定用户不加载对方模型（省一半首屏带宽），绑定后才拉起
  const partnerLoaderRef = useRef<(() => void) | null>(null)
  // V1.3 换装：当前已加载的形象 + 帧率档位（swap 时按当前档位选纹理 LOD）
  const meAvatarRef = useRef<string>(DEFAULT_AVATAR)
  const partnerAvatarRef = useRef<string | null>(null)
  const governorRef = useRef<PerfGovernor | null>(null)

  const stateRef = useRef({ mood, visibility, me, partner, partnerMood, bond })
  // V2.0 Task 3：互动发送用例（socket → 1.6s ack 超时 → REST 幂等兜底）。
  // eventId 生成/回执匹配/超时重发全部在用例内部，App 只消费结果做 UI 反馈
  const interactor = useRef(
    createSendInteraction({ emit, isSocketConnected, restInteract: api.interact }),
  )
  // V2.0 Task 6：双人编排会话（prepare 暂存 → start 执行；busy 防重入）
  const stagedMomentRef = useRef<{
    momentId: string
    role: 'initiator' | 'receiver'
    plan: ChoreographyPlan
    contactGapPx: number
  } | null>(null)
  const choreoBusyRef = useRef(false)
  stateRef.current = { mood, visibility, me, partner, partnerMood, bond }

  // V1.6.0 情侣徽章：双方 style/outfit 命中同一主题即点亮（纯客户端匹配，服务端零新列）
  const coupleBadge = useMemo(
    () => (partner ? matchCoupleTheme(myStyle, myOutfit, partnerLook.style, partnerLook.outfit) : null),
    [partner, myStyle, myOutfit, partnerLook],
  )
  // 徽章点亮瞬间：双人头顶冒心（同主题只冒一次）
  useEffect(() => {
    if (coupleBadge) spawnCoupleHearts(coupleBadge.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coupleBadge?.id])

  // toast 自动消失（升级提示/绑定提示/互动提示统一走这条）
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(''), 2600)
    return () => clearTimeout(t)
  }, [toast])

  // ---------- 初始化身份 ----------
  useEffect(() => {
    const saved = localStorage.getItem('da_me')
    const url = new URL(location.href)
    const invite = url.searchParams.get('invite')
    if (saved) {
      const u = JSON.parse(saved)
      // V1.5.0：形象库里没有的 id（如已移除的 mark）一律回退默认形象，避免加载失败
      meAvatarRef.current = (u.avatar && MODEL_URLS[u.avatar] ? u.avatar : null) ?? DEFAULT_AVATAR
      const nu = { ...u, avatar: meAvatarRef.current }
      setMe(nu)
      if (meAvatarRef.current !== u.avatar) {
        localStorage.setItem('da_me', JSON.stringify(nu))
      }
      // V1.3 换装：向服务端对齐形象与穿搭（localStorage 里可能没有 style 列）
      api.getState(u.id).then((r) => {
        // V1.4.0：服务端 style 与本地持久化不一致时才重载模型（一致则初始加载已带风格，零额外开销）
        const localStyle = localStorage.getItem('da_style') ?? 'default'
        if (r.style && r.style !== 'default' && r.style !== localStyle) {
          setMyStyle(r.style)
          localStorage.setItem('da_style', r.style)
          meSprite.current?.applyStyle(r.style)
        } else if (r.style && r.style !== 'default') {
          setMyStyle(r.style)
        }
        // V1.5.0 衣橱 2.0：服务端款式权威对齐（换设备场景），本地一致则初始加载已带款式
        const localOutfit = localStorage.getItem('da_outfit') ?? 'base'
        if (r.outfit && r.outfit !== 'base' && r.outfit !== localOutfit) {
          setMyOutfit(r.outfit)
          localStorage.setItem('da_outfit', r.outfit)
          meSprite.current?.applyVariant(r.outfit)
        }
        if (r.avatar && r.avatar !== meAvatarRef.current) {
          // 服务端的形象更新（比如换过设备）
          meAvatarRef.current = r.avatar
          const nu = { ...u, avatar: r.avatar }
          setMe(nu)
          localStorage.setItem('da_me', JSON.stringify(nu))
          swapMyModel(r.avatar)
        }
      }).catch(() => { })
      if (invite) {
        api.acceptInvite(invite, u.id).then((r) => {
          setToast(`收到 ${r.partner.name} 送你的数字分身！`)
          // 回到应用页（生产部署在 /digital-avatar/ 子路径，不能用 location.origin）
          location.href = location.origin + import.meta.env.BASE_URL
        }).catch((e) => {
          // 服务端 V1.3.2：任一方已有绑定会拒绝（409 already_bound）
          const msg: string = e?.message ?? ''
          setToast(msg.includes('already_bound')
            ? '你或 TA 已经绑定了其他分身啦'
            : msg.includes('404') ? '邀请链接无效' : '邀请接受失败，请重试')
        })
      }
    } else {
      ; (window as any).__pendingInvite = invite
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---------- 初始化 Pixi 舞台 ----------
  useEffect(() => {
    if (!canvasHost.current || appRef.current) return
    const app = new PIXI.Application({
      resizeTo: window,
      backgroundAlpha: 0,
      // 性能优化（证据存档见 docs/ARCHITECTURE.md）：
      // - antialias:false —— PixiJS 官方弱设备首要建议（MSAA 逐帧开销大，Live2D 网格在 2x 分辨率下肉眼几乎无差）
      // - resolution 跟随 DPR 上限 2x + autoDensity —— HiDPI 点对点清晰，同时防 4K 屏过度填充
      antialias: false,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
      powerPreference: 'high-performance',
    })
    canvasHost.current.appendChild(app.view as HTMLCanvasElement)
    appRef.current = app

    // 自适应帧率治理：60/30/20 三档，掉帧自动降档（?perf= 可强制，?fps=1 看 HUD）
    // tier 同步传给 AvatarSprite.load，用于纹理 LOD（balanced/saver → SD 半图）
    const governor = new PerfGovernor(app)
    const tier = governor.current
    governorRef.current = governor

    const meS = new AvatarSprite()
    const partnerS = new AvatarSprite()
    meSprite.current = meS
    partnerSprite.current = partnerS

    // 自己的模型立即加载（按自己选定的形象）；对方的模型懒加载（绑定后才拉起，未绑定用户首屏减半）
    // V1.3.3：初始形象直接同步读 localStorage——不依赖身份 effect 的执行次序，
    // 杜绝"先载默认形象、身份 effect 到位后再换"的双重加载（真机上白耗一倍首屏时间）
    try {
      const savedAvatar = JSON.parse(localStorage.getItem('da_me') || 'null')?.avatar
      if (savedAvatar && MODEL_URLS[savedAvatar]) meAvatarRef.current = savedAvatar
    } catch { /* 忽略坏数据 */ }
    // V1.4.0 真实换装：初始加载即带穿搭风格（同步读 localStorage，避免"先原生再重载"的双重加载）
    try {
      const savedStyle = localStorage.getItem('da_style')
      if (savedStyle && (OUTFIT_STYLES as any)[savedStyle]) meS.style = savedStyle
      // V1.5.0 衣橱 2.0：初始加载即带款式（整纹理替换），同样避免双开
      const savedOutfit = localStorage.getItem('da_outfit')
      if (savedOutfit && savedOutfit !== 'base') meS.variant = savedOutfit
    } catch { /* 忽略坏数据 */ }
    // V2.0 Task 8 资产失败回退链：首选形象 → 失败回落内置默认形象（仅一次）→ 仍失败进安全占位态。
    // 任何路径都结束 booting；占位态给重试入口，绝不让用户对着空白舞台。
    const placeMe = (key: string) => {
      meS.setPosition(window.innerWidth * 0.32, homeYFor(key, meS.model?.height ?? 0))
        ; (window as any).__stageReady = true
    }
    const loadMeModel = async (key: string, isFallback = false): Promise<void> => {
      try {
        await meS.load(app.stage, MODEL_URLS[key] ?? MODEL_URLS[DEFAULT_AVATAR], MODEL_SCALE, tier)
        meAvatarRef.current = key
        placeMe(key)
        setBooting(false)
        if (isFallback) setToast('分身形象暂时加载失败，已为你换回默认形象')
      } catch (e) {
        console.error('[stage] 模型加载失败', key, e)
        if (!isFallback && key !== DEFAULT_AVATAR) {
          // 用户自选形象（含未来 Jing/Tao 正式包）损坏/CDN 抖动 → 回退旧的内置模型
          return loadMeModel(DEFAULT_AVATAR, true)
        }
        // 默认形象也失败（通常是整站断连/缓存损坏）：安全占位态，不白屏
        setBooting(false)
        setStageError(true)
      }
    }
    void loadMeModel(meAvatarRef.current ?? DEFAULT_AVATAR)

    // 触控统一绑定一次（拖拽/长按菜单/右键菜单），换装/换形象无需重绑
    bindStageTouch(app)

    let partnerLoading = false
    const loadPartnerModel = () => {
      if (partnerLoading || partnerS.model) return
      partnerLoading = true
      const pAvatar = stateRef.current.partner?.avatar ?? 'natori'
      partnerAvatarRef.current = pAvatar
      // V1.4.0：加载前就设置对方穿搭风格（避免"先原生再重载"的双重加载）
      const pStyle = stateRef.current.partner?.style
      if (pStyle && (OUTFIT_STYLES as any)[pStyle]) partnerS.style = pStyle
      // V1.5.0 衣橱 2.0：加载前就设置对方款式（同防双开）
      const pOutfit = stateRef.current.partner?.outfit
      if (pOutfit && pOutfit !== 'base') partnerS.variant = pOutfit
      partnerS.load(app.stage, MODEL_URLS[pAvatar] ?? MODEL_URLS.natori, MODEL_SCALE, tier).then(() => {
        // 与自己同款 home 规则（全身贴 Dock / 半身压边）
        partnerS.setPosition(window.innerWidth * 0.68, homeYFor(pAvatar, partnerS.model?.height ?? 0))
        // 加载完成时按当前状态决定可见性与表情（getPartner 可能早已返回，竞态兜底）
        partnerS.model!.visible = !!stateRef.current.partner
        partnerS.setMood(stateRef.current.partnerMood ?? 'neutral')
      }).catch((e) => {
        // V2.0 Task 8：对方模型加载失败不影响己方舞台 —— 气泡/互动仍可达，仅提示一次
        partnerLoading = false
        console.error('[stage] 对方模型加载失败', pAvatar, e)
        setToast('TA 的分身暂时没加载出来，稍后会自动重试')
      })
    }
    partnerLoaderRef.current = loadPartnerModel

      // 自动化测试/调试探针（生产保留无害，仅供控制台检查舞台状态）
      ; (window as any).__pixi = { app, meS, partnerS }

    app.ticker.add(() => {
      meS.tick()
      partnerS.tick()
    })

    return () => {
      stageTouchDisposer.current?.()
      app.destroy(true)
      appRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---------- 绑定后拉起对方模型并显示 ----------
  useEffect(() => {
    if (!partner) return
    partnerLoaderRef.current?.()
    if (partnerSprite.current?.model) {
      partnerSprite.current.model.visible = true
    }
  }, [partner])

  // ---------- 触控统一绑定（V1.3.2 重构） ----------
  // 真机问题：之前依赖 PIXI interaction 的 pointerdown 在触屏上不可靠（拖拽/长按全失效）。
  // 改为 DOM 指针事件 + 显式命中测试（hitTest 失败再退回包围盒 AABB），双保险。
  const stageTouchDisposer = useRef<(() => void) | null>(null)
  const bindStageTouch = (app: PIXI.Application) => {
    const canvas = app.view as HTMLCanvasElement
    let active: { who: 'me' | 'partner'; sprite: AvatarSprite } | null = null
    let dragging = false
    let moved = 0
    let last = { x: 0, y: 0 }
    let pressTimer: number | null = null

    const openMenuAt = (who: 'me' | 'partner', x: number, y: number) => {
      // 菜单弹出坐标夹取在视口内（触屏点小人边缘时不至于被截断）；
      // V2.0 加了「双人时刻」分区，高度预算提到 460px
      setMenu({
        x: Math.min(Math.max(12, x), window.innerWidth - 200),
        y: Math.min(Math.max(12, y), window.innerHeight - 460),
        target: who,
      })
    }

    /** 命中测试：几何命中（PIXI hitTest 沿 parent 链归到模型）最优先——所见即所得；
     *  无几何命中时，在"真实绘制范围包含点击点"的候选里选最近中心者（触屏宽容）。
     *  V1.3.3 修复：不能用 getBounds（moc 画布含大块空白）做兜底——对方画布
     *  会盖住空白点击区导致拖错人/拖不动；也不能固定 partner 优先。 */
    const pick = (x: number, y: number) => {
      const candidates: Array<{ who: 'me' | 'partner'; sprite: AvatarSprite | null }> = [
        { who: 'partner', sprite: partnerSprite.current },
        { who: 'me', sprite: meSprite.current },
      ]
      const im = (app.renderer as any).plugins?.interaction as any
      let hits: any[] = []
      try {
        const r = im?.hitTest?.({ x, y })
        hits = Array.isArray(r) ? r : r ? [r] : []
      } catch (_e) { hits = [] }
      const isDescendant = (h: any, m: any) => {
        for (let o = h; o; o = o.parent) if (o === m) return true
        return false
      }
      // 1) 几何精确命中（最上层可见模型）
      for (const h of hits) {
        for (const c of candidates) {
          const m = c.sprite?.model
          if (m?.visible && isDescendant(h, m)) return { who: c.who, sprite: c.sprite! }
        }
      }
      // 2) 最近中心兜底（点在角色附近空白时的触屏宽容）
      let best: { who: 'me' | 'partner'; sprite: AvatarSprite; d2: number } | null = null
      for (const c of candidates) {
        const b = c.sprite?.realBounds?.()
        if (!b) continue
        if (x < b.x || x > b.x + b.width || y < b.y || y > b.y + b.height) continue
        const dx = x - (b.x + b.width / 2)
        const dy = y - (b.y + b.height / 2)
        const d2 = dx * dx + dy * dy
        if (!best || d2 < best.d2) best = { who: c.who, sprite: c.sprite!, d2 }
      }
      return best ? { who: best.who, sprite: best.sprite } : null
    }

    const onDown = (e: PointerEvent) => {
      if (!e.isPrimary) return
      const hit = pick(e.clientX, e.clientY)
      if (!hit) return
      active = hit
      dragging = true
      moved = 0
      last = { x: e.clientX, y: e.clientY }
      // 触屏长按 550ms = 菜单；移动超过阈值即视为拖拽并取消
      if (pressTimer != null) clearTimeout(pressTimer)
      const sx = e.clientX
      const sy = e.clientY
      pressTimer = window.setTimeout(() => {
        pressTimer = null
        if (!dragging || moved >= 10) return
        dragging = false
        openMenuAt(active!.who, sx, sy)
      }, 550)
    }
    const onMove = (e: PointerEvent) => {
      if (!dragging || !active?.sprite.model) return
      const model = active.sprite.model
      // 触屏 movementX/Y 常为 undefined → 统一用 clientX/Y 差值（autoDensity 下 == CSS 像素）
      const dx = e.clientX - last.x
      const dy = e.clientY - last.y
      last = { x: e.clientX, y: e.clientY }
      moved += Math.abs(dx) + Math.abs(dy)
      if (moved >= 10 && pressTimer != null) {
        clearTimeout(pressTimer)
        pressTimer = null
      }
      model.x = Math.min(window.innerWidth - 60, Math.max(60, model.x + dx))
      // V1.6.2：底边 clamp 按"脚底不出屏"计算（半高动态取自模型），高模型拖到底也不会沉进 Dock 缺腿
      model.y = Math.min(window.innerHeight - model.height / 2, Math.max(120, model.y + dy))
      // 同步 target/home：否则 tick() 的 lerp 会把模型往原位拉，拖拽像在跟自己较劲
      active.sprite.cancelReturn()
      active.sprite.target.x = model.x
      active.sprite.target.y = model.y
      active.sprite.home.x = model.x
      active.sprite.home.y = model.y
    }
    const onUp = (e: PointerEvent) => {
      if (!dragging || !active) return
      dragging = false
      if (pressTimer != null) {
        clearTimeout(pressTimer)
        pressTimer = null
      }
      if (moved < 6) {
        // 单击：默认互动
        if (active.who === 'partner') {
          sendAction('poke')
        } else {
          active.sprite.play('poke')
        }
      } else {
        edgePose(active.sprite)
      }
      active = null
      void e
    }
    const onCancel = () => {
      dragging = false
      active = null
      if (pressTimer != null) {
        clearTimeout(pressTimer)
        pressTimer = null
      }
    }
    const onCtx = (e: MouseEvent) => {
      // 桌面右键菜单
      e.preventDefault()
      const hit = pick(e.clientX, e.clientY)
      if (hit) openMenuAt(hit.who, e.clientX, e.clientY)
    }
    canvas.addEventListener('pointerdown', onDown)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    canvas.addEventListener('contextmenu', onCtx)
    stageTouchDisposer.current = () => {
      canvas.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      canvas.removeEventListener('contextmenu', onCtx)
    }
  }

  /** 拖到屏幕边缘时的探头/倾斜姿态 */
  const edgePose = (sprite: AvatarSprite) => {
    const model = sprite.model
    if (!model) return
    const W = window.innerWidth
    if (model.x < W * 0.12) model.rotation = -0.12 // 靠左探出
    else if (model.x > W * 0.88) model.rotation = 0.12 // 靠右探出
    else model.rotation = 0
  }

  // ---------- 粒子（心/蛋糕/花……随动作变化） ----------
  const spawnHearts = (x: number, y: number, n = 6, emoji = '💛') => {
    const items = Array.from({ length: n }, (_, i) => ({
      id: Date.now() + i,
      x: x + (Math.random() - 0.5) * 120,
      y: y + (Math.random() - 0.5) * 60,
      emoji,
    }))
    setHearts((h) => [...h, ...items])
    setTimeout(() => setHearts((h) => h.filter((i) => !items.includes(i))), 2600)
  }

  // ---------- 发送互动（V2.0 Task 3 重构） ----------
  // 动作语义与降级链在 actions/registry：旧模型能力表下 feed/flower 降级为 wave（与
  // V1.2 行为一致），未知动作落通用反应（idle+表情），动画失败不阻断事件发送
  const playPlanLocal = (sprite: AvatarSprite | null, plan: ActionPlan) => {
    if (plan.level === 'exact' || plan.level === 'semantic') {
      sprite?.play(plan.actionId)
    } else if (plan.level === 'generic') {
      if (!sprite) return
      // 通用反应：表情闪现 happy，2.5s 后回到自己当前状态
      sprite.setMood('happy')
      window.setTimeout(() => sprite.setMood(stateRef.current.mood), 2500)
    }
    // neutral-bubble / event-only：本地无动画（气泡仍会显示，事件照常发送）
  }

  // ---------- V2.0 Task 6：双人编排（服务端状态机权威，客户端只同步开始时间/阶段标记，禁止逐帧同步） ----------
  /** 按序推进状态机；单步失败（网络/非法转移）不阻断后续——服务端是权威，重复推进幂等 */
  const advanceThrough = async (momentId: string, states: ChoreographyState[]) => {
    for (const s of states) {
      try { await advanceMoment(momentPorts, momentId, s) } catch { /* 忽略，状态以服务端为准 */ }
    }
  }

  /** 旧模型 → 渲染器端口（编排走位/动作都走端口，内部过动作注册表降级链） */
  const adapterFor = (sprite: AvatarSprite | null, avatarKey: string | null): LegacyPixiAdapter | null => {
    if (!sprite?.model) return null
    const manifest = legacyManifest(avatarKey ?? DEFAULT_AVATAR) ?? legacyManifest(DEFAULT_AVATAR)
    return manifest ? new LegacyPixiAdapter(sprite, manifest) : null
  }

  /** 发起双人编排：建 moment（requested）→ socket 广播 prepare → 两端 ready → 服务端 start */
  const startChoreography = useCallback(async (actionId: string) => {
    const cur = stateRef.current
    if (!cur.me) return
    setMenu(null)
    if (!cur.partner) {
      setToast('先把分身送给 TA，绑定后才有双人时刻 🤝')
      return
    }
    if (choreoBusyRef.current) {
      setToast('上一场双人时刻还在进行中')
      return
    }
    const plan = createChoreography(actionId, [cur.me.id, cur.partner.id])
    if (!plan) return
    // 先占位再走 REST：防双击连点发起两个 moment（后续失败路径都要复位）
    choreoBusyRef.current = true
    // relationshipId = bond.id；bond 尚未拉到时现取一次（initiate 早于 getBond 返回的窗口）
    let relId = cur.bond?.id ?? null
    if (!relId) {
      try {
        const r = await api.getBond(cur.me.id)
        if (r.bond) {
          setBond(r.bond)
          relId = r.bond.id
        }
      } catch { /* 忽略，下方兜底提示 */ }
    }
    if (!relId) {
      choreoBusyRef.current = false
      setToast('绑定信息还没就绪，稍后再试')
      return
    }
    const created = await prepareSharedMoment(momentPorts, {
      relationshipId: relId,
      choreographyId: plan.choreographyId,
      actionId,
      senderId: cur.me.id,
      receiverId: cur.partner.id,
    })
    if (!created.moment) {
      choreoBusyRef.current = false
      setToast('发起失败，请稍后重试')
      return
    }
    // 服务端校验 bond 后向两端广播 moment.prepare（含发起端回声）；socket 断链时 prepare
    // 不会回来 → 9s 后自动放行（状态机停在 requested 无副作用），避免永久卡死
    emit('moment.prepare', {
      momentId: created.moment.momentId,
      choreographyId: plan.choreographyId,
      actionId,
      senderId: cur.me.id,
      receiverId: cur.partner.id,
    })
    setTimeout(() => { choreoBusyRef.current = false }, 9000)
    setToast(`${CHOREO_EMOJI[actionId] ?? '💫'} 等 TA 就绪，一起${labelOf(actionId)}…`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** moment.prepare：暂存编排 + 回报就绪；状态机由发起端权威推进（接收端不推，防双端竞争） */
  const handleMomentPrepare = useCallback((p: any) => {
    if (!p?.momentId) return
    const cur = stateRef.current
    if (!cur.me) return
    if (p.senderId !== cur.me.id && p.receiverId !== cur.me.id) return
    const role: 'initiator' | 'receiver' = p.senderId === cur.me.id ? 'initiator' : 'receiver'
    const plan = createChoreography(p.actionId ?? 'hug', [p.senderId, p.receiverId])
    if (!plan) return // 未知编排：不 ready → 服务端宽限后开跑 → 发起端单侧 partial（契约降级）
    stagedMomentRef.current = {
      momentId: p.momentId,
      role,
      plan,
      contactGapPx: p.anchors?.contactGapPx ?? 120,
    }
    if (role === 'receiver') {
      setToast(`${CHOREO_EMOJI[p.actionId] ?? '💫'} ${cur.partner?.name ?? 'TA'} 想和你${labelOf(plan.actionId)}`)
    }
    // 模型常驻无需装填，立即回报就绪；服务端集齐两端即提前开跑
    emit('moment.ready', { momentId: p.momentId })
    if (role === 'initiator') void advanceThrough(p.momentId, ['accepted', 'preparing', 'ready'])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** moment.start：两端按服务端 startAt 各自跑五阶段时间轴（不逐帧同步），发起端收尾落库 */
  const handleMomentStart = useCallback((p: any) => {
    const staged = stagedMomentRef.current
    if (!staged || !p?.momentId || p.momentId !== staged.momentId) return
    stagedMomentRef.current = null
    const cur = stateRef.current
    const mS = meSprite.current
    if (!mS?.model) {
      choreoBusyRef.current = false
      return
    }
    const meAdapter = adapterFor(mS, meAvatarRef.current)
    if (!meAdapter) {
      choreoBusyRef.current = false
      return
    }
    const partnerAdapter = adapterFor(cur.partner ? partnerSprite.current : null, partnerAvatarRef.current ?? cur.partner?.avatar ?? null)
    const markers: Array<{ phase: ChoreographyPhase; at: string }> = []
    const actionId = staged.plan.actionId
    if (staged.role === 'initiator') void advanceThrough(staged.momentId, ['playing'])
    void runChoreography({
      role: staged.role,
      plan: staged.plan,
      startAt: typeof p.startAt === 'number' ? p.startAt : Date.now(),
      me: meAdapter,
      partner: partnerAdapter,
      contactGapPx: staged.contactGapPx,
      onPhase: (phase) => {
        markers.push({ phase, at: new Date().toISOString() })
        if (phase === 'contact') {
          const px = partnerAdapter?.anchorPoint('root')?.x ?? mS.x
          spawnHearts((mS.x + px) / 2, mS.y - 260, actionId === 'hug' ? 10 : 5, actionId === 'hug' ? '💛' : '✨')
          setBubble({ who: 'me', text: actionBubble(actionId) })
          setTimeout(() => setBubble(null), 4200)
        }
      },
    }).then((res) => {
      choreoBusyRef.current = false
      // 发起端收尾：完成/部分完成连阶段标记一起落库（服务端据此写 shared_moment 回忆）
      if (staged.role === 'initiator') {
        void advanceMoment(momentPorts, staged.momentId, res.outcome === 'completed' ? 'completed' : 'partial', markers).catch(() => { })
        if (res.outcome === 'completed') setToast(`💕 一起${labelOf(actionId)}啦！已记入回忆`)
        else setToast('对方好像没接住，这次先记作「差一点点」')
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const sendAction = useCallback((action: string, message?: string) => {
    const cur = stateRef.current
    if (!cur.me) return
    // V2.0 Task 6：hug 升级为双人编排（走位 + 双人动作 + 落回忆）；未绑定走原单人互动引导
    if (action === 'hug' && cur.partner) {
      void startChoreography('hug')
      return
    }
    // 本地反馈先行（未绑定点按钮也有动作反馈，而不是"点了没反应"）
    playPlanLocal(meSprite.current, resolveAction(legacyCapabilities(), action))
    if (!message) {
      setBubble({ who: 'me', text: actionBubble(action) })
      setTimeout(() => setBubble(null), 5000)
    }
    // 未绑定时给出明确引导
    if (!cur.partner) {
      setToast('先把分身送给 TA，绑定后就能互动啦 🎁')
      return
    }
    // V2.0 互动发送：socket 实时为主，ack 超时/离线自动 REST 兜底（eventId 幂等去重）；
    // 彻底断网（REST 也失败）→ outbox 暂存，重连后按 eventId 回放去重
    interactor.current.sendInteraction({
      senderId: cur.me.id,
      receiverId: cur.partner.id,
      actionId: action,
      message: message ?? null,
    }).then((r) => {
      if (!r.event) {
        outbox.enqueue(r.eventId, r.payload)
        setToast('网络不太通，消息已暂存，恢复后自动送达 📶')
      }
    }).catch(() => { /* 用例内部已吞错；理论不可达 */ })
    const mS = meSprite.current
    if (mS) {
      if (action === 'heart' || action === 'hug') spawnHearts(mS.x, mS.y - 260, 4, '💛')
      if (action === 'feed') spawnHearts(mS.x, mS.y - 260, 3, '🧁')
      if (action === 'flower') spawnHearts(mS.x, mS.y - 260, 3, '💐')
    }
    const s = partnerSprite.current
    if (s) {
      if (action === 'heart' || action === 'hug') spawnHearts(s.x, s.y - 260, 6, '💛')
      if (action === 'feed') spawnHearts(s.x, s.y - 260, 5, '🧁')
      if (action === 'flower') spawnHearts(s.x, s.y - 260, 5, '💐')
    }
    setMenu(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---------- 双人拥抱序列 ----------
  const playHugSequence = useCallback(async () => {
    const pS = partnerSprite.current
    const mS = meSprite.current
    if (!pS || !mS || !pS.model) return
    pS.walkTo(mS.x + 90, mS.y)
    await new Promise((r) => setTimeout(r, 1800))
    spawnHearts((pS.x + mS.x) / 2, mS.y - 280, 10)
    mS.play('pat')
    pS.play('pat')
    pS.setMood('happy')
    await new Promise((r) => setTimeout(r, 3000))
    pS.goHome()
    pS.setMood('neutral')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---------- 接收互动 ----------
  const handleIncoming = useCallback((ev: InteractionEvent) => {
    setEvents((prev) => [ev, ...prev])
    const cur = stateRef.current
    const who: 'me' | 'partner' = ev.senderId === cur.me?.id ? 'me' : 'partner'
    // socket 链路的自回声（self: true）只用于记时间线——发送端在 sendAction 里已本地
    // 播放过一轮，这里再播会双重回应（动作二连、气泡闪两下）
    if ((ev as any).self) return
    const sprite = who === 'me' ? meSprite.current : partnerSprite.current

    if (ev.action === 'hug') {
      playHugSequence()
      return
    }
    if (ev.message) {
      setBubble({ who, text: ev.message })
      setTimeout(() => setBubble(null), 5000)
      return
    }
    // 气泡反馈不依赖模型就绪（对方模型还在加载时也必有可见反馈）；动作播放可跳过
    if (who === 'me' && cur.mood === 'low') {
      // 互动后发现：如果自己（接收方）状态是 low，播放异常反应
      sprite?.playSadReaction()
      return
    }
    setBubble({ who, text: actionBubble(ev.action) })
    setTimeout(() => setBubble(null), 5000)
    if (!sprite) return
    // V2.0 Task 3：接收侧播放同样走动作注册表降级链（feed/flower→wave，未知动作→通用反应）
    const plan = resolveAction(legacyCapabilities(), ev.action)
    playPlanLocal(sprite, plan)
    if (ev.action === 'heart' || ev.action === 'hug') spawnHearts(sprite.x, sprite.y - 260, 6, '💛')
    if (ev.action === 'feed') spawnHearts(sprite.x, sprite.y - 260, 5, '🧁')
    if (ev.action === 'flower') spawnHearts(sprite.x, sprite.y - 260, 5, '💐')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---------- Socket 生命周期 ----------
  useEffect(() => {
    if (!me) return
    connectSocket(me.id, {
      // V2.0 Task 8：socket.io 重连成功 → 回放离线发件箱（服务端按 eventId 幂等去重）
      connect: () => { void flushOutbox() },
      interaction: handleIncoming,
      partner_online: (online: boolean) => setPartnerOnline(online),
      // V1.3.3：TA 接受邀请时服务端向邀请人推 bonded —— 之前客户端没接这个事件，
      // 邀请人已打开的页面永远不显示对方（表现为"邀请链接没用"，只能手动刷新）
      bonded: (p: any) => {
        if (p?.partner) {
          setPartner(p.partner)
          setToast(`已与 ${p.partner.name} 绑定 🤝`)
          // 绑定即时拉取 relationshipId（回忆时间线/共同时刻要用），不等下次刷新
          api.getBond(me.id).then((r) => setBond(r.bond)).catch(() => { })
        }
      },
      state_update: (s: any) => {
        // V1.3 换装：对方换了形象/穿搭/款式，实时跟随
        if (s.avatar || s.style || s.outfit) {
          swapPartnerLook(s)
          // V1.6.0：同步记录对方的 style/outfit（情侣徽章实时重算）
          setPartnerLook((prev) => ({ style: s.style ?? prev.style, outfit: s.outfit ?? prev.outfit }))
        }
        // 只在对方公开状态时展示；对方分身表情同步变化
        if (s.visibility === 'public') {
          setPartnerMood(s.mood)
          partnerSprite.current?.setMood(s.mood)
        } else {
          setPartnerMood(null)
          partnerSprite.current?.setMood('neutral')
        }
      },
      // V2.0 Task 7 解绑：任一端在「我的」页解绑后双端收到 —— 回到未绑定态（回忆保留在服务端）
      unbonded: () => {
        setPartner(null)
        setBond(null)
        setPartnerMood(null)
        setPartnerOnline(false)
        partnerSprite.current?.setMood('neutral')
        if (partnerSprite.current?.model) partnerSprite.current.model.visible = false
        setToast('已解绑。你们的回忆还留在回忆页里 💛')
      },
      // V2.0 Task 6：互动回执转投发送用例（内部按 eventId 匹配等待者；超时已兜底的忽略）
      interaction_ack: (ev: any) => interactor.current.handleAck(ev),
      // V2.0 Task 6：双人编排同步（服务端只广播 prepare/start；时间轴执行在本地）
      // 注意：这里的 key 是原始 socket 事件名（memories/socket.js emit 的点分名）
      'moment.prepare': (p: any) => handleMomentPrepare(p),
      'moment.start': (p: any) => handleMomentStart(p),
      'moment.prepare_rejected': (p: any) => {
        choreoBusyRef.current = false
        setToast(p?.reason === 'not bonded' ? '双人时刻发起失败：绑定关系校验未通过' : '双人时刻发起失败')
      },
      // V1.6.0 情侣装：服务端权威结算后的双端应用。
      // 发起端也会收到回声 —— applyCoupleMemberSelf/swapPartnerLook 内部 _applied 判重，幂等零重载
      couple_applied: (p: any) => {
        const meId = stateRef.current.me?.id
        if (!p?.members || !meId) return
        const theme = COUPLE_THEMES[p.themeId]
        for (const m of p.members) {
          if (m.userId === meId) void applyCoupleMemberSelf(m)
          else {
            setPartnerLook({ style: m.style, outfit: m.outfit })
            swapPartnerLook(m)
          }
        }
        if (p.by !== meId && theme) setToast(`${theme.emoji} TA 给你换上了${theme.label}！`)
      },
    })
    api.getPartner(me.id).then(async (r) => {
      if (!r.partner) return
      setPartner(r.partner)
      // 拉取对方持久化状态（TA 离线期间改的状态/换的穿搭也能看到）
      try {
        const st = await api.getState(r.partner.id)
        if (st.state && st.state.visibility === 'public') {
          setPartnerMood(st.state.mood)
          partnerSprite.current?.setMood(st.state.mood)
        }
        if (st.style && st.style !== 'default') partnerSprite.current?.applyStyle(st.style)
        // V1.6.0：记录对方的持久化穿搭（徽章匹配 + 衣橱高亮）
        setPartnerLook({ style: st.style ?? 'default', outfit: st.outfit ?? 'base' })
      } catch (_e) { /* 忽略，避免阻塞 */ }
    })
    api.getState(me.id).then((r) => {
      if (r.state) {
        setMood(r.state.mood)
        setVisibility(r.state.visibility)
        // 刷新后自己的分身也恢复到当前状态的表现
        meSprite.current?.setMood(r.state.mood)
      }
      // V1.6.0：服务端权威对齐 style/outfit —— 离线期间 TA 给你换了情侣装（或你在
      // 另一台设备改了装）时，localStorage 是旧的，这里拉齐并热更新分身
      const stNow = r.style ?? 'default'
      const ofNow = r.outfit ?? 'base'
      if (stNow !== localStorage.getItem('da_style') || ofNow !== (localStorage.getItem('da_outfit') ?? 'base')) {
        setMyStyle(stNow)
        localStorage.setItem('da_style', stNow)
        setMyOutfit(ofNow)
        localStorage.setItem('da_outfit', ofNow)
        const s = meSprite.current
        if (s) {
          s.style = stNow
          s.variant = ofNow
          s.applyVariant(ofNow).catch(() => { })
          s.applyStyle(stNow).catch(() => { })
        }
      }
    })
    api.getEvents(me.id).then((r) => setEvents(r.events))
    // 拉取 relationshipId（回忆时间线/共同时刻关联键；旧火花字段只读兼容，客户端不再消费）
    api.getBond(me.id).then((r) => setBond(r.bond)).catch(() => { })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me])

  // ---------- 设置状态 ----------
  // V2.0 Task 7 解绑：服务端删 bond 并向双端推 unbonded；这里同时做本地复位
  // （socket 断链时推送可能丢，本地复位保证发起端 UI 一定回未绑定态）
  const doUnbind = async () => {
    const cur = stateRef.current
    if (!cur.me) return
    try {
      const r = await api.unbind(cur.me.id)
      if (r.ok) {
        setPartner(null)
        setBond(null)
        setPartnerMood(null)
        setPartnerOnline(false)
        partnerSprite.current?.setMood('neutral')
        if (partnerSprite.current?.model) partnerSprite.current.model.visible = false
        setToast('已解绑。你们的回忆还留在回忆页里 💛')
      } else {
        setToast(r.error === 'no_bond' ? '你们还没有绑定哦' : '解绑失败，请稍后重试')
      }
    } catch {
      setToast('解绑失败，请稍后重试')
    }
    setConfirmUnbind(false)
  }

  // ---------- V2.0 Task 8：离线发件箱回放 ----------
  // 触发时机：socket 重连（connect 事件）/ 浏览器 online / 回到前台。
  // flush 内部并发安全（进行中复用同一 promise）；送达后刷新时间线并提示。
  const flushOutbox = useCallback(async () => {
    if (outbox.pendingCount() === 0) return
    const r = await outbox.flush()
    const settled = r.delivered + r.duplicate
    if (settled > 0) {
      setToast(`网络恢复，${settled} 条暂存消息已送达 📨`)
      const curId = stateRef.current.me?.id
      if (curId) api.getEvents(curId).then((ev) => setEvents(ev.events)).catch(() => { })
    }
    if (r.failed > 0) setToast(`还有 ${r.failed} 条没送出去，会继续重试`)
  }, [])

  useEffect(() => outbox.subscribe(setOutboxCount), [])
  useEffect(() => {
    const onOnline = () => { void flushOutbox() }
    const onVisible = () => { if (!document.hidden) void flushOutbox() }
    window.addEventListener('online', onOnline)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('online', onOnline)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [flushOutbox])

  const applyMood = async (m: Mood, v?: Visibility) => {
    if (!me) return
    const vis = v ?? visibility
    setMood(m)
    if (v) setVisibility(v)
    meSprite.current?.setMood(m)
    await api.setState(me.id, m, vis)
    // 公开或每次选择-分享时才实时通知对方
    if (vis === 'public') {
      emit('state_update', { userId: me.id, mood: m, visibility: vis })
    }
    setShowMoodPicker(false)
  }

  // ---------- V1.3 换装：切换形象（销毁旧模型 + 加载新模型，双端同步） ----------
  const swapMyModel = async (key: string): Promise<boolean> => {
    const app = appRef.current
    const sprite = meSprite.current
    if (!app || !sprite || !MODEL_URLS[key]) return false
    const home = { ...sprite.home }
    const prev = meAvatarRef.current
    meAvatarRef.current = key
    try {
      await sprite.swap(app.stage, MODEL_URLS[key], MODEL_SCALE, governorRef.current?.current ?? 'high')
    } catch (e) {
      // swap 先销毁旧模型才加载新模型：失败必须回滚旧形象，不能留空白舞台
      console.error('[swap] 模型加载失败', e)
      meAvatarRef.current = prev
      if (prev !== key && MODEL_URLS[prev]) {
        await sprite
          .swap(app.stage, MODEL_URLS[prev], MODEL_SCALE, governorRef.current?.current ?? 'high')
          .catch(() => { })
        sprite.setPosition(home.x, homeYFor(prev, sprite.model?.height ?? 0))
        sprite.setMood(stateRef.current.mood)
      }
      return false
    }
    // V1.6.2：形象切换后按新模型的半身/全身规则重算 home y（旧 home 是上一个模型的构图）
    sprite.setPosition(home.x, homeYFor(key, sprite.model?.height ?? 0))
    sprite.setMood(stateRef.current.mood)
    return true
  }

  const applyAvatar = async (key: string) => {
    if (!me || meAvatarRef.current === key) return
    // 加载提示先行（换模型需拉取资源，给用户即时反馈而不是"点了没反应"）
    setToast('换装中…')
    const ok = await swapMyModel(key)
    if (!ok) {
      setToast('换装失败，请稍后重试')
      return
    }
    const nu = { ...me, avatar: key }
    setMe(nu)
    localStorage.setItem('da_me', JSON.stringify(nu))
    api.setLook(me.id, { avatar: key }).catch(() => { })
    emit('state_update', { userId: me.id, avatar: key })
    // V1.5.0：换形象后若当前穿搭色板不属于新形象的性别（如女款粉 → 男模），
    // 自动回落"原生"，避免 UI 里选不回已隐藏的女款
    const st = OUTFIT_STYLES[myStyle]
    const g = AVATAR_GENDER[key] ?? 'f'
    // V1.5.0：换形象后款式/色板都跟着形象走——旧款式属于旧形象的纹理文件，
    // 必须回落 base；色板性别不符时回落"原生"
    if (myOutfit !== 'base' && !OUTFIT_VARIANTS[key]?.some((v) => v.id === myOutfit)) {
      setMyOutfit('base')
      localStorage.setItem('da_outfit', 'base')
      api.setLook(me.id, { outfit: 'base' }).catch(() => { })
      emit('state_update', { userId: me.id, avatar: key, outfit: 'base' })
      meSprite.current?.applyVariant('base').catch(() => { })
    }
    if (st?.gender && st.gender !== g) void applyStyleLocal('default')
    setToast(`已换上 ${AVATAR_LABELS[key] ?? key}`)
  }

  /**
   * 切换款式（V1.5.0 衣橱 2.0：整张服装纹理替换，真·换衣服），双端同步。
   * 颜色轴（myStyle）保持不变——款式 × 颜色可自由组合。
   */
  const applyVariantLocal = async (variantId: string) => {
    if (!me) return
    setMyOutfit(variantId)
    localStorage.setItem('da_outfit', variantId)
    const label = OUTFIT_VARIANTS[me.avatar]?.find((v) => v.id === variantId)?.label ?? variantId
    setToast(variantId === 'base' ? '换回原款…' : `换款式：${label}…`)
    await meSprite.current?.applyVariant(variantId)
    api.setLook(me.id, { outfit: variantId }).catch(() => { })
    emit('state_update', { userId: me.id, outfit: variantId })
    setToast(variantId === 'base' ? '已换回原款' : `已换上 ${label}`)
  }

  /** 切换穿搭风格（V1.4.0 真实换装：重染服装纹理，肤色不变），双端同步 */
  const applyStyleLocal = async (styleId: string) => {
    if (!me) return
    setMyStyle(styleId)
    localStorage.setItem('da_style', styleId)
    const label = OUTFIT_STYLES[styleId]?.label ?? styleId
    setToast(styleId === 'default' ? '换回原生…' : `换装中：${label}…`)
    // applyStyle 内部保持位置/可见性/心情，重载完成即新配色生效
    await meSprite.current?.applyStyle(styleId)
    api.setLook(me.id, { style: styleId }).catch(() => { })
    emit('state_update', { userId: me.id, style: styleId })
    setToast(styleId === 'default' ? '已换回原生' : `已换上 ${label}`)
  }

  // ---------- V1.6.0 情侣衣橱 ----------
  /** 把服务端结算的 member 穿搭应用到自己身上（发起端/接收端共用；_applied 判重保证零重载幂等） */
  const applyCoupleMemberSelf = async (m: { style: string; outfit: string }) => {
    setMyStyle(m.style)
    localStorage.setItem('da_style', m.style)
    setMyOutfit(m.outfit)
    localStorage.setItem('da_outfit', m.outfit)
    const s = meSprite.current
    if (!s) return
    // 先设字段再走 applyVariant→applyStyle：applyVariant 重载时已带上新 style（单次加载双轴生效），
    // applyStyle 若已被同一轮 load 应用过则 _applied 判重直接跳过
    s.style = m.style
    s.variant = m.outfit
    await s.applyVariant(m.outfit)
    await s.applyStyle(m.style)
  }

  /** 点亮情侣装同款时的双人冒心（同主题只冒一次，避免徽章重算反复触发） */
  const coupleHeartsFired = useRef<string | null>(null)
  const spawnCoupleHearts = (themeId: string) => {
    if (coupleHeartsFired.current === themeId) return
    coupleHeartsFired.current = themeId
    for (const sp of [meSprite.current, partnerSprite.current]) {
      const model = sp?.model
      if (!model) continue
      const b = model.getBounds()
      spawnHearts(b.x + b.width / 2, b.y - 10, 5, '💖')
    }
  }

  /** 一键情侣装：服务端权威结算 → 双端应用（本地乐观 + couple_applied 回声幂等） */
  const applyCoupleTheme = async (themeId: string) => {
    if (!me || !partner) return
    const theme = COUPLE_THEMES[themeId]
    if (!theme) return
    setToast(`换上${theme.label}…`)
    try {
      const r = await api.coupleOutfit(me.id, themeId)
      const members: any[] = r.members ?? []
      const self = members.find((m) => m.userId === me.id)
      const other = members.find((m) => m.userId !== me.id)
      if (self) await applyCoupleMemberSelf(self)
      if (other) {
        setPartnerLook({ style: other.style, outfit: other.outfit })
        swapPartnerLook(other)
      }
      spawnCoupleHearts(themeId)
      setToast(`${theme.emoji} ${theme.label}已同步到两端`)
    } catch (e: any) {
      const msg: string = e?.message ?? ''
      setToast(msg.includes('no_bond') ? '还没有和 TA 绑定哦' : '情侣装同步失败，请稍后重试')
    }
  }

  /** 解除情侣装：双方回 原生+base（服务端 'none' 主题结算） */
  const applyCoupleReset = async () => {
    if (!me || !partner) return
    setToast('解除情侣装…')
    try {
      const r = await api.coupleOutfit(me.id, 'none')
      const members: any[] = r.members ?? []
      const self = members.find((m) => m.userId === me.id)
      const other = members.find((m) => m.userId !== me.id)
      if (self) await applyCoupleMemberSelf(self)
      if (other) {
        setPartnerLook({ style: other.style, outfit: other.outfit })
        swapPartnerLook(other)
      }
      coupleHeartsFired.current = null
      setToast('已解除情侣装')
    } catch (_e) {
      setToast('解除失败，请稍后重试')
    }
  }

  /** 对方换装（socket 通知到达时换 TA 的模型/穿搭/款式） */
  const swapPartnerLook = (look: { avatar?: string; style?: string; outfit?: string }) => {
    const app = appRef.current
    const sprite = partnerSprite.current
    if (!app || !sprite) return
    if (look.avatar && partnerAvatarRef.current !== look.avatar && MODEL_URLS[look.avatar]) {
      // 形象+风格+款式一起换：先同步记录 style/outfit（load 时按它们生效），单次加载避免双开
      if (look.style && (OUTFIT_STYLES as any)[look.style]) sprite.style = look.style
      // V1.5.0：款式属于形象——换形象时款式必须回落 base，否则旧款式的纹理文件名
      // 撞到新形象的纹理会张冠李戴（applyOutfitVariant 按形象查表，查不到是无害 no-op，
      // 但 sprite.variant 残留会让后续 applyStyle 的 rectKey 查错）
      sprite.variant = look.avatar === partnerAvatarRef.current ? sprite.variant : 'base'
      if (look.outfit && look.outfit !== 'base') {
        const av = look.avatar ?? partnerAvatarRef.current
        if (av && OUTFIT_VARIANTS[av]?.some((v) => v.id === look.outfit)) sprite.variant = look.outfit
      }
      const home = { ...sprite.home }
      partnerAvatarRef.current = look.avatar
      sprite
        .swap(app.stage, MODEL_URLS[look.avatar], MODEL_SCALE, governorRef.current?.current ?? 'high')
        .then(() => {
          sprite.setPosition(home.x, homeYFor(look.avatar ?? partnerAvatarRef.current ?? 'natori', sprite.model?.height ?? 0))
          sprite.model!.visible = !!stateRef.current.partner
          sprite.setMood(stateRef.current.partnerMood ?? 'neutral')
        })
        .catch((e) => console.error('[swap] 对方形象加载失败', e))
    } else if (look.outfit && look.outfit !== (sprite.variant ?? 'base')) {
      // 换款式（可能连颜色一起，如情侣装下发）：先同步 style 字段，
      // applyVariant 单次重载即双轴生效；颜色没变时 applyStyle 后续会被 _applied 判重跳过
      if (look.style && (OUTFIT_STYLES as any)[look.style]) sprite.style = look.style
      sprite.applyVariant(look.outfit).catch((e) => console.error('[swap] 对方换款式失败', e))
    } else if (look.style) {
      // 仅换风格：applyStyle 内部按原参数重载（保持位置/可见性/心情）
      sprite.applyStyle(look.style).catch((e) => console.error('[swap] 对方换装失败', e))
    }
  }

  // ---------- 创建身份 ----------
  const createIdentity = async () => {
    if (!nickname.trim()) return
    const { user } = await api.createUser(nickname.trim())
    localStorage.setItem('da_me', JSON.stringify(user))
    setMe(user)
    // V1.3：新身份的随机形象与当前加载的不一致时立即换上
    const key = user.avatar ?? 'hiyori'
    if (key !== meAvatarRef.current) swapMyModel(key)
    const invite = (window as any).__pendingInvite
    if (invite) {
      try {
        const r = await api.acceptInvite(invite, user.id)
        setToast(`收到 ${r.partner.name} 送你的数字分身！`)
        setTimeout(() => (location.href = location.origin + import.meta.env.BASE_URL), 1200)
      } catch (e: any) {
        const msg: string = e?.message ?? ''
        setToast(msg.includes('already_bound') ? '你或 TA 已经绑定了其他分身啦' : '邀请链接无效')
      }
    }
  }

  // ---------- 生成邀请 ----------
  const makeInvite = async () => {
    if (!me) return
    const { code } = await api.createInvite(me.id)
    // 生产部署在 /digital-avatar/ 子路径：邀请链接必须带 BASE_URL，否则 TA 打开是作品集首页
    const link = `${location.origin}${import.meta.env.BASE_URL}?invite=${code}`
    setInviteLink(link)
    navigator.clipboard?.writeText(link).catch(() => { })
  }

  const sendShortMessage = (text: string) => {
    if (!text.trim()) return
    sendAction('wave', text.trim())
    setMenu(null)
  }

  // ================= 渲染 =================
  // 关键：canvas-host 必须是 .space 的第一个、且永远存在的子节点。
  // 若引导页/主界面各写一个 return，React 换树时会重建 canvas-host 节点，
  // 已 append 进去的 Pixi canvas 会随旧节点一起被丢弃 → 分身消失（只能靠碰运气的 DOM 复用）。
  return (
    <div className={`space${petMode ? ' petmode' : ''}`}>
      <div ref={canvasHost} className="canvas-host" />
      {!petMode && <div className="aurora" aria-hidden><span /><span /><span /></div>}

      {!me ? (
        <div className="onboard">
          <div className="onboard-card">
            <h1>数字分身</h1>
            <p className="sub">把一个属于你的人，放到另一个人的身边。</p>
            <input
              placeholder="给自己起个名字…"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && createIdentity()}
            />
            <button onClick={createIdentity}>创建我的分身</button>
          </div>
        </div>
      ) : (
        <>
          {/* 首个模型加载中提示（渲染感知性能：让等待"可见"） */}
          {booting && <div className="loading-pill">✨ 分身登场中…</div>}
          {/* V2.0 Task 8：断网暂存提示（点击可立即尝试重发） */}
          {outboxCount > 0 && (
            <button className="outbox-pill" onClick={() => void flushOutbox()}>
              📶 {outboxCount} 条消息等待联网送达 · 点击重试
            </button>
          )}
          {/* V2.0 Task 8：安全占位态（默认形象也加载失败时，不白屏） */}
          {stageError && (
            <div className="stage-error" role="alert">
              <div className="stage-error-card">
                <div className="stage-error-emoji" aria-hidden>🌧️</div>
                <p>分身资源暂时加载失败，可能是网络不稳定或缓存出了问题</p>
                <button className="btn" onClick={() => window.location.reload()}>重新加载</button>
              </div>
            </div>
          )}

          {/* 顶栏（精简：状态设置收进「我的」Tab）；桌宠模式下整个壳都藏起来 */}
          {!petMode && (
            <div className="topbar">
              <div className="brand">数字分身</div>
              <div className="topbar-right">
                {partner ? (
                  <span className="chip">
                    {partner.name} {partnerOnline ? '🟢' : '⚪'}
                    {partnerMood && partnerMood !== 'neutral' && ` · ${MOOD_LABELS[partnerMood]}`}
                  </span>
                ) : (
                  <button className="btn ghost" onClick={makeInvite}>把我的分身送给 TA</button>
                )}
              </div>
            </div>
          )}

          {/* 互动 Dock（陪伴 Tab）；桌宠模式下换成迷你坞 */}
          {tab === 'companion' && !petMode && (
            <div className="dock">
              {DOCK.map((d) => (
                <button key={d.id} className="dock-btn" onClick={() => sendAction(d.id)}>
                  <span className="dock-emoji">{d.emoji}</span>
                  <span className="dock-label">{labelOf(d.id)}</span>
                </button>
              ))}
            </div>
          )}

          {/* V1.4.3 桌宠模式 UI：迷你互动坞 + 退出按钮（模型拖拽/点按/长按与常驻模式一致） */}
          {petMode && (
            <>
              {/* V1.6.1 状态行（对标 Codex Pet Desk 状态显示）：桌宠模式一眼看到 TA 在不在、TA 的状态 */}
              <div className="pet-status">
                {partner
                  ? <>💫 {partner.name}{partnerMood && partnerMood !== 'neutral' ? ` · ${MOOD_LABELS[partnerMood]}` : ' · 在线'}</>
                  : <>🤝 还没绑定 TA（「把我的分身送给 TA」生成邀请）</>}
              </div>
              <div className="pet-dock">
                {DOCK.map((d) => (
                  <button key={d.id} className="dock-btn" onClick={() => sendAction(d.id)}>
                    <span className="dock-emoji">{d.emoji}</span>
                  </button>
                ))}
              </div>
              <button className="pet-exit" onClick={togglePetMode} title="退出桌宠模式">
                🖥️
              </button>
            </>
          )}

          {/* V2.0 Task 6：回忆时间线（原任务页升级；里程碑/共同时刻/纪念日按天倒序，可删除） */}
          {tab === 'memories' && !petMode && (
            <MemoryTimeline
              relationshipId={bond?.id ?? null}
              onToast={setToast}
            />
          )}

          {/* 记录 Tab */}
          {tab === 'records' && !petMode && (
            <div className="panel">
              {events.length === 0 && <p className="sub">还没有互动，去戳戳 TA 吧</p>}
              <ul className="records-list">
                {events.map((ev) => (
                  <li key={ev.id}>
                    <span className="time">
                      {parseTime(ev.createdAt).toLocaleString('zh-CN', {
                        month: 'numeric',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                    <span>
                      {ev.senderId === me.id ? '你' : partner?.name ?? 'TA'}
                      {ev.message
                        ? ` 说：${ev.message}`
                        : ` ${labelOf(ev.action)}`}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 我的 Tab */}
          {tab === 'me' && !petMode && (
            <div className="panel">
              <div className="panel-card">
                <h3>{me.name}</h3>
                <p className="sub">
                  {partner
                    ? `与 ${partner.name} 已绑定 ❤`
                    : '还没有绑定 TA'}
                  {coupleBadge && (
                    <span className="couple-badge">✨ {coupleBadge.emoji} {coupleBadge.label}</span>
                  )}
                </p>
                {/* V2.0 Task 7 解绑流程：两步确认；成功后双端收 unbonded 回到未绑定态（回忆保留） */}
                {partner && (
                  <div className="unbind-row">
                    {confirmUnbind ? (
                      <>
                        <span className="unbind-warn">解绑后需要重新邀请才能再绑定，确定？</span>
                        <button
                          className="btn danger"
                          onClick={doUnbind}
                        >确定解绑</button>
                        <button className="btn ghost" onClick={() => setConfirmUnbind(false)}>再想想</button>
                      </>
                    ) : (
                      <button className="btn ghost unbind-btn" onClick={() => setConfirmUnbind(true)}>
                        解除绑定
                      </button>
                    )}
                  </div>
                )}
              </div>
              {/* V1.3.2 形象库（配置化）+ 穿搭风格，双端实时同步 */}
              <div className="panel-card">
                <h4>形象</h4>
                <div className="wardrobe-row">
                  {AVATAR_LIBRARY.map((a) => (
                    <button
                      key={a.id}
                      className={`style-chip ${((me.avatar ?? 'hiyori') === a.id) ? 'active' : ''}`}
                      aria-pressed={(me.avatar ?? 'hiyori') === a.id}
                      onClick={() => applyAvatar(a.id)}
                    >
                      <span className="style-emoji">{AVATAR_EMOJI[a.id] ?? '🧑‍🎤'}</span>
                      <span className="style-label">{a.label} · {a.tag}</span>
                    </button>
                  ))}
                </div>
                <h4>穿搭</h4>
                {/* V1.5.0 衣橱 2.0：款式行（整纹理替换，真·换衣服）。
                    只有配置了 variants 的模型显示（Chitose/Haru）；Hiyori/Natori 条款禁改 → 无此行 */}
                {(OUTFIT_VARIANTS[me.avatar ?? '']?.length ?? 0) > 0 && (
                  <div className="wardrobe-row variant-row">
                    {OUTFIT_VARIANTS[me.avatar ?? '']!.map((v) => (
                      <button
                        key={v.id}
                        className={`style-chip variant-chip ${myOutfit === v.id ? 'active' : ''}`}
                        style={myOutfit === v.id
                          ? { borderColor: v.swatch, boxShadow: `0 0 0 3px ${v.swatch}33, 0 0 14px ${v.swatch}44` }
                          : undefined}
                        aria-pressed={myOutfit === v.id}
                        onClick={() => applyVariantLocal(v.id)}
                      >
                        <span className="style-emoji">{v.id === 'base' ? '🧷' : '🧢'}</span>
                        <span className="style-label">{v.label}</span>
                      </button>
                    ))}
                  </div>
                )}
                <h4>情侣装</h4>
                {/* V1.6.0 一键情侣装：有 partner 才显示。服务端权威结算（按双方形象性别取槽位），双端同步 */}
                {partner && (
                  <div className="wardrobe-row couple-row">
                    {COUPLE_THEME_ORDER.map((id) => {
                      const t = COUPLE_THEMES[id]
                      const active = coupleBadge?.id === id
                      return (
                        <button
                          key={id}
                          className={`style-chip couple-chip ${active ? 'active' : ''}`}
                          style={active
                            ? { borderColor: t.swatch[1], boxShadow: `0 0 0 3px ${t.swatch[0]}33, 0 0 14px ${t.swatch[1]}44` }
                            : undefined}
                          aria-pressed={active}
                          onClick={() => applyCoupleTheme(id)}
                        >
                          <span
                            className="couple-dot"
                            style={{ background: `linear-gradient(135deg, ${t.swatch[0]}, ${t.swatch[1]})` }}
                          />
                          <span className="style-label">{t.emoji} {t.label}</span>
                        </button>
                      )
                    })}
                    <button className="style-chip couple-chip" onClick={applyCoupleReset}>
                      <span className="style-emoji">🚪</span>
                      <span className="style-label">解除</span>
                    </button>
                  </div>
                )}
                <div className="wardrobe-row">
                  {/* V1.5.0：色板按当前形象性别过滤（无 gender 标记的 = 通用，永远显示） */}
                  {Object.entries(OUTFIT_STYLES).filter(([, p]) => {
                    const g = AVATAR_GENDER[me.avatar ?? DEFAULT_AVATAR] ?? 'f'
                    return !p.gender || p.gender === g
                  }).map(([id, p]) => (
                    <button
                      key={id}
                      className={`style-chip ${myStyle === id ? 'active' : ''}`}
                      style={myStyle === id && p.swatch !== '#c9c9d6'
                        ? { borderColor: p.swatch, boxShadow: `0 0 0 3px ${p.swatch}33, 0 0 14px ${p.swatch}44` }
                        : undefined}
                      aria-pressed={myStyle === id}
                      onClick={() => applyStyleLocal(id)}
                    >
                      <span className="style-emoji">{p.swatch === '#c9c9d6' ? '🌱' : '👗'}</span>
                      <span className="style-label">{p.label}</span>
                    </button>
                  ))}
                </div>
                <p className="sub tiny">真实换装：款式整件换 + 颜色随心染，肤色永远不变；会实时同步到 TA 的屏幕上</p>
              </div>
              <div className="panel-card">
                <button className="btn block" onClick={() => setShowMoodPicker(true)}>
                  设置状态 · 当前：{MOOD_LABELS[mood]} / {VIS_LABELS[visibility]}
                </button>
                {!partner && (
                  <button className="btn ghost block" onClick={makeInvite}>
                    把我的分身送给 TA
                  </button>
                )}
                <button className="btn ghost block" onClick={() => setTheme(theme === 'v1' ? 'v2' : 'v1')}>
                  🎨 切换主题（当前：{theme === 'v1' ? 'v1 经典' : 'v2 极光'}）
                </button>
                {/* V1.4.3 桌宠模式入口：藏起 App 壳，只留一只随身的 Live2D 小人 */}
                <button className="btn ghost block" onClick={togglePetMode}>
                  🐱 桌宠模式（悬浮小人）
                </button>
              </div>
              {/* V1.5.0：Live2D 官方条款要求的版权声明（Free Material License） */}
              <p className="sub center tiny">
                数字分身 V1.5.0 · Chitose 形象升级 + 性别化衣橱<br />
                This content uses sample data owned and copyrighted by Live2D Inc.
              </p>
            </div>
          )}

          {/* 底部 Tab 导航（桌宠模式下隐藏） */}
          {!petMode && (
            <nav className="tabbar">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  className={`tab ${tab === t.id ? 'active' : ''}`}
                  onClick={() => setTab(t.id)}
                >
                  <span className="tab-emoji">{t.emoji}</span>
                  <span className="tab-label">{t.label}</span>
                </button>
              ))}
            </nav>
          )}

          {/* 邀请链接弹窗 */}
          {inviteLink && (
            <div className="modal" onClick={() => setInviteLink('')}>
              <div className="modal-card" onClick={(e) => e.stopPropagation()}>
                <h3>把链接发给 TA</h3>
                <p className="link-text">{inviteLink}</p>
                <p className="sub">TA 打开接受后，你的分身就会住进 TA 的设备里</p>
                {/* 剪贴板可能被浏览器静默拒绝：给手动复制兜底 */}
                <div className="look-row">
                  <button
                    className="btn"
                    onClick={() => {
                      navigator.clipboard?.writeText(inviteLink).then(
                        () => setToast('已复制，去粘贴给 TA 吧'),
                        () => setToast('复制失败，请长按链接手动复制'),
                      )
                    }}
                  >复制链接</button>
                  <button className="btn ghost" onClick={() => setInviteLink('')}>好</button>
                </div>
              </div>
            </div>
          )}

          {/* 小人菜单 */}
          {menu && (
            <div className="ctxmenu" style={{ left: menu.x, top: menu.y }}>
              {menu.target === 'partner' && (
                <>
                  <div className="ctxmenu-title">给 {partner?.name}</div>
                  {/* V2.0 Task 6：单人互动与双人编排分区（hug 归入双人时刻） */}
                  {ACTIONS.filter((a) => !(CHOREOGRAPHY_ACTIONS as readonly string[]).includes(a)).map((a) => (
                    <button key={a} onClick={() => sendAction(a)}>
                      {labelOf(a)}
                    </button>
                  ))}
                  <div className="ctxmenu-title">双人时刻</div>
                  {CHOREOGRAPHY_ACTIONS.map((a) => (
                    <button key={a} onClick={() => startChoreography(a)}>
                      {CHOREO_EMOJI[a] ?? '💫'} {labelOf(a)}
                    </button>
                  ))}
                  <SayInput onSend={sendShortMessage} />
                </>
              )}
              {menu.target === 'me' && (
                <div className="ctxmenu-title">这是你自己的分身哦</div>
              )}
              <button className="ctxmenu-close" onClick={() => setMenu(null)}>×</button>
            </div>
          )}

          {/* 状态选择器 */}
          {showMoodPicker && (
            <div className="modal" onClick={() => setShowMoodPicker(false)}>
              <div className="modal-card" onClick={(e) => e.stopPropagation()}>
                <h3>现在感觉怎么样？</h3>
                <div className="mood-grid">
                  {(Object.keys(MOOD_LABELS) as Mood[]).map((m) => (
                    <button
                      key={m}
                      className={`btn ${mood === m ? 'active' : ''}`}
                      onClick={() => applyMood(m, visibility)}
                    >
                      {MOOD_LABELS[m]}
                    </button>
                  ))}
                </div>
                <h4>谁能看到</h4>
                <div className="mood-grid">
                  {(Object.keys(VIS_LABELS) as Visibility[]).map((v) => (
                    <button
                      key={v}
                      className={`btn ${visibility === v ? 'active' : ''}`}
                      onClick={() => applyMood(mood, v)}
                    >
                      {VIS_LABELS[v]}
                    </button>
                  ))}
                </div>
                {visibility === 'discover-after' && (
                  <p className="sub">对方互动后，你的分身会用不一样的方式回应 TA</p>
                )}
              </div>
            </div>
          )}

          {/* 短句气泡 */}
          {bubble && (
            <div className={`bubble ${bubble.who}`}>{bubble.text}</div>
          )}

          {/* 粒子（心/蛋糕/花） */}
          {hearts.map((h) => (
            <div key={h.id} className="heart" style={{ left: h.x, top: h.y }}>
              {h.emoji}
            </div>
          ))}

          {toast && <div className="toast">{toast}</div>}
        </>
      )}

      {/* UI 版本对比切换（v1 初版 / v2 aurora-glass） */}
      <button
        className="theme-switch"
        title="切换 UI 版本"
        onClick={() => setTheme(theme === 'v1' ? 'v2' : 'v1')}
      >
        🎨
      </button>
    </div>
  )
}

/** SQLite 的 localtime 格式 "YYYY-MM-DD HH:MM:SS" 需转成可解析格式 */
function parseTime(s: string) {
  return new Date(s.includes('T') || s.includes('Z') ? s : s.replace(' ', 'T'))
}

function SayInput({ onSend }: { onSend: (t: string) => void }) {
  const [v, setV] = useState('')
  return (
    <div className="say">
      <input
        autoFocus
        placeholder="说一句话…"
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            onSend(v)
            setV('')
          }
        }}
      />
      <button onClick={() => { onSend(v); setV('') }}>发</button>
    </div>
  )
}
