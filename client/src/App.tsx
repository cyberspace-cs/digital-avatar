import React, { useEffect, useRef, useState, useCallback } from 'react'
import * as PIXI from 'pixi.js'
import './pixi-setup'
import { AvatarSprite } from './live2d/avatar'
import { PerfGovernor } from './live2d/perf'
import { api } from './api'
import { connectSocket, emit, getSocket } from './socket'
import Admin from './Admin'
import type { BondMeta, InteractionEvent, Mood, QuestItem, User, Visibility } from './types'

// 模型路径需带 base 前缀（生产部署在 /digital-avatar/ 子路径下）
const BASE = import.meta.env.BASE_URL
const MY_MODEL = `${BASE}models/hiyori/Hiyori.model3.json`
const PARTNER_MODEL = `${BASE}models/natori/Natori.model3.json`
const MODEL_SCALE = 0.12

type MenuPos = { x: number; y: number; target: 'me' | 'partner' } | null
type Tab = 'companion' | 'quests' | 'records' | 'me'

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
const ACTIONS = [
  { id: 'poke', label: '戳一下' },
  { id: 'pat', label: '摸摸头' },
  { id: 'hug', label: '抱抱' },
  { id: 'heart', label: '比心' },
  { id: 'wave', label: '挥手' },
  { id: 'pinch', label: '捏脸' },
  { id: 'feed', label: '喂食' },
  { id: 'flower', label: '送花' },
]
// 互动 Dock（V1.2 小火人化）
const DOCK = [
  { id: 'feed', emoji: '🧁' },
  { id: 'pat', emoji: '🫳' },
  { id: 'poke', emoji: '👉' },
  { id: 'hug', emoji: '🤗' },
  { id: 'flower', emoji: '💐' },
]
// 火花等级（与服务端 LEVELS 阈值一致，仅用于进度条计算）
const LEVELS = [
  { level: 1, name: '火种', at: 0 },
  { level: 2, name: '火苗', at: 100 },
  { level: 3, name: '小火人', at: 300 },
  { level: 4, name: '烈焰', at: 700 },
  { level: 5, name: '燎原', at: 1500 },
  { level: 6, name: '不灭', at: 3000 },
  { level: 7, name: '永恒', at: 6000 },
]
const TABS: { id: Tab; emoji: string; label: string }[] = [
  { id: 'companion', emoji: '🏠', label: '陪伴' },
  { id: 'quests', emoji: '🎯', label: '任务' },
  { id: 'records', emoji: '💞', label: '记录' },
  { id: 'me', emoji: '⚙️', label: '我的' },
]

export default function App() {
  // 管理后台隐藏入口：仅在 #/admin 时渲染，不出现在用户主界面
  // （hash 不带页面内变更，刷新后路径一致，hooks 调用顺序稳定）
  if (location.hash === '#/admin') {
    return <Admin />
  }

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
  // V1.2 小火人化：Tab 壳 + 火花成长
  const [tab, setTab] = useState<Tab>('companion')
  const [bond, setBond] = useState<BondMeta | null>(null)
  const [quests, setQuests] = useState<QuestItem[]>([])

  // 对方 Live2D 模型懒加载器：未绑定用户不加载 Natori（省一半首屏带宽），绑定后才拉起
  const partnerLoaderRef = useRef<(() => void) | null>(null)

  const stateRef = useRef({ mood, visibility, me, partner, partnerMood, bond })
  stateRef.current = { mood, visibility, me, partner, partnerMood, bond }

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
      setMe(u)
      if (invite) {
        api.acceptInvite(invite, u.id).then((r) => {
          setToast(`收到 ${r.partner.name} 送你的数字分身！`)
          // 回到应用页（生产部署在 /digital-avatar/ 子路径，不能用 location.origin）
          location.href = location.origin + import.meta.env.BASE_URL
        }).catch(() => setToast('邀请链接无效'))
      }
    } else {
      ; (window as any).__pendingInvite = invite
    }
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

    const meS = new AvatarSprite()
    const partnerS = new AvatarSprite()
    meSprite.current = meS
    partnerSprite.current = partnerS

    // 自己的模型立即加载；对方的模型懒加载（绑定后才拉起，未绑定用户首屏减半）
    meS.load(app.stage, MY_MODEL, MODEL_SCALE, tier).then(() => {
      meS.setPosition(window.innerWidth * 0.35, window.innerHeight * 0.78)
      bindDrag(meS, 'me')
        ; (window as any).__stageReady = true
    })

    let partnerLoading = false
    const loadPartnerModel = () => {
      if (partnerLoading || partnerS.model) return
      partnerLoading = true
      partnerS.load(app.stage, PARTNER_MODEL, MODEL_SCALE, tier).then(() => {
        partnerS.setPosition(window.innerWidth * 0.65, window.innerHeight * 0.78)
        bindDrag(partnerS, 'partner')
        // 加载完成时按当前状态决定可见性与表情（getPartner 可能早已返回，竞态兜底）
        partnerS.model!.visible = !!stateRef.current.partner
        const st = stateRef.current
        if (st.bond?.cold) partnerS.setMood('low')
        else partnerS.setMood(st.partnerMood ?? 'neutral')
      })
    }
    partnerLoaderRef.current = loadPartnerModel

    // 自动化测试/调试探针（生产保留无害，仅供控制台检查舞台状态）
    ;(window as any).__pixi = { app, meS, partnerS }

    app.ticker.add(() => {
      meS.tick()
      partnerS.tick()
    })

    return () => {
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

  // ---------- 拖拽 + 边缘姿态 + 触屏长按菜单 ----------
  const bindDrag = (sprite: AvatarSprite, who: 'me' | 'partner') => {
    let dragging = false
    let moved = 0
    let last = { x: 0, y: 0 }
    let pressTimer: number | null = null
    const model = sprite.model!

    // 菜单弹出坐标夹取在视口内（触屏点小人边缘时不至于被截断）
    const openMenuAt = (x: number, y: number) => {
      setMenu({
        x: Math.min(Math.max(12, x), window.innerWidth - 200),
        y: Math.min(Math.max(12, y), window.innerHeight - 320),
        target: who,
      })
    }

    model.on('pointerdown', (e: PIXI.InteractionEvent) => {
      dragging = true
      moved = 0
      const g = e.data.global
      last = { x: g.x, y: g.y }
      // 触屏长按 550ms = 菜单（桌面右键走 rightdown）；移动超过阈值即视为拖拽并取消
      if (pressTimer != null) clearTimeout(pressTimer)
      pressTimer = window.setTimeout(() => {
        pressTimer = null
        if (!dragging || moved >= 10) return
        dragging = false
        openMenuAt(g.x, g.y)
      }, 550)
    })

    const onMove = (e: PointerEvent) => {
      if (!dragging) return
      // 触屏 PointerEvent.movementX/Y 常为 undefined → NaN 会把模型坐标算飞；
      // 统一用 clientX/Y 差值（autoDensity 下 PIXI 全局坐标 == CSS 像素）
      const dx = e.clientX - last.x
      const dy = e.clientY - last.y
      last = { x: e.clientX, y: e.clientY }
      moved += Math.abs(dx) + Math.abs(dy)
      if (moved >= 10 && pressTimer != null) {
        clearTimeout(pressTimer)
        pressTimer = null
      }
      model.x = Math.min(window.innerWidth - 60, Math.max(60, model.x + dx))
      model.y = Math.min(window.innerHeight - 40, Math.max(120, model.y + dy))
      // 同步 target/home：否则 tick() 的 lerp 会把模型往原位拉，拖拽像在跟自己较劲
      sprite.cancelReturn()
      sprite.target.x = model.x
      sprite.target.y = model.y
      sprite.home.x = model.x
      sprite.home.y = model.y
    }
    const onUp = () => {
      if (!dragging) return
      dragging = false
      if (pressTimer != null) {
        clearTimeout(pressTimer)
        pressTimer = null
      }
      if (moved < 6) {
        // 单击：默认互动
        if (who === 'partner') {
          sendAction('poke')
        } else {
          sprite.play('poke')
        }
      } else {
        edgePose(sprite)
      }
    }
    const onCancel = () => {
      dragging = false
      if (pressTimer != null) {
        clearTimeout(pressTimer)
        pressTimer = null
      }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)

    model.on('rightdown', (e: PIXI.InteractionEvent) => {
      e.data.originalEvent.preventDefault()
      openMenuAt(e.data.global.x, e.data.global.y)
    })
    sprite.model!.on('pointerdown', () => sprite.model!.cursor = 'grab')
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

  // ---------- 发送互动 ----------
  const sendAction = useCallback((action: string, message?: string) => {
    const cur = stateRef.current
    if (!cur.me) return
    // 未绑定时给出明确引导，而不是按钮点了没反应
    if (!cur.partner) {
      setToast('先把分身送给 TA，绑定后就能互动啦 🎁')
      return
    }
    emit('interaction', {
      senderId: cur.me.id,
      receiverId: cur.partner.id,
      action,
      message: message ?? null,
    })
    // 本地立即播放发送方反馈（自己的分身做一个示意动作）
    meSprite.current?.play(action === 'feed' || action === 'flower' ? 'wave' : action)
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
    if (!sprite) return
    // 互动后发现：如果自己（接收方）状态是 low，播放异常反应
    if (who === 'me' && cur.mood === 'low') {
      sprite.playSadReaction()
    } else {
      sprite.play(ev.action)
      if (ev.action === 'heart' || ev.action === 'hug') spawnHearts(sprite.x, sprite.y - 260, 6, '💛')
      if (ev.action === 'feed') spawnHearts(sprite.x, sprite.y - 260, 5, '🧁')
      if (ev.action === 'flower') spawnHearts(sprite.x, sprite.y - 260, 5, '💐')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---------- Socket 生命周期 ----------
  const refreshQuests = useCallback(() => {
    const uid = stateRef.current.me?.id
    if (!uid) return
    api.getQuests(uid).then((r) => setQuests(r.quests)).catch(() => {})
  }, [])

  useEffect(() => {
    if (!me) return
    connectSocket(me.id, {
      interaction: handleIncoming,
      partner_online: (online: boolean) => setPartnerOnline(online),
      state_update: (s: any) => {
        // 只在对方公开状态时展示；对方分身表情同步变化
        if (s.visibility === 'public') {
          setPartnerMood(s.mood)
          partnerSprite.current?.setMood(s.mood)
        } else {
          setPartnerMood(null)
          partnerSprite.current?.setMood('neutral')
        }
      },
      // V1.2 火花成长：服务端结算后双端实时同步
      growth_update: (g: any) => {
        setBond(g.bond)
        if (g.leveledUp) setToast(`🔥 火花升级！Lv.${g.bond.level} ${g.bond.levelName}`)
        refreshQuests()
      },
    })
    api.getPartner(me.id).then(async (r) => {
      if (!r.partner) return
      setPartner(r.partner)
      // 拉取对方持久化状态（TA 离线期间改的状态也能看到）
      try {
        const st = await api.getState(r.partner.id)
        if (st.state && st.state.visibility === 'public') {
          setPartnerMood(st.state.mood)
          partnerSprite.current?.setMood(st.state.mood)
        }
      } catch (_e) { /* 忽略，避免阻塞 */ }
    })
    api.getState(me.id).then((r) => {
      if (r.state) {
        setMood(r.state.mood)
        setVisibility(r.state.visibility)
        // 刷新后自己的分身也恢复到当前状态的表现
        meSprite.current?.setMood(r.state.mood)
      }
    })
    api.getEvents(me.id).then((r) => setEvents(r.events))
    // V1.2：拉取火花成长与每日任务
    api.getBond(me.id).then((r) => setBond(r.bond)).catch(() => {})
    refreshQuests()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me])

  // ---------- 断联软惩罚：火花变灰时，仅对 neutral 的分身叠加沮丧表情 ----------
  useEffect(() => {
    if (!bond) return
    if (bond.cold) {
      if (mood === 'neutral') meSprite.current?.setMood('low')
      if (!partnerMood || partnerMood === 'neutral') partnerSprite.current?.setMood('low')
    } else {
      // 复燃：恢复各自当前状态的表现
      if (mood === 'neutral') meSprite.current?.setMood('neutral')
      partnerSprite.current?.setMood(partnerMood ?? 'neutral')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bond?.cold, mood, partnerMood])

  // ---------- 设置状态 ----------
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

  // ---------- 创建身份 ----------
  const createIdentity = async () => {
    if (!nickname.trim()) return
    const { user } = await api.createUser(nickname.trim())
    localStorage.setItem('da_me', JSON.stringify(user))
    setMe(user)
    const invite = (window as any).__pendingInvite
    if (invite) {
      const r = await api.acceptInvite(invite, user.id)
      setToast(`收到 ${r.partner.name} 送你的数字分身！`)
      setTimeout(() => (location.href = location.origin + import.meta.env.BASE_URL), 1200)
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
    <div className="space">
      <div ref={canvasHost} className="canvas-host" />
      <div className="aurora" aria-hidden><span /><span /><span /></div>

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
          {/* 等级光晕：火花等级越高越亮，断联时熄灭 */}
          {bond && !bond.cold && (
            <div
              className="spark-glow"
              style={{ opacity: 0.25 + (bond.level / 7) * 0.55 }}
              aria-hidden
            />
          )}

          {/* 顶栏（精简：状态设置收进「我的」Tab） */}
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

          {/* 火花关系卡（陪伴 Tab） */}
          {tab === 'companion' && bond && (
            <div className={`bond-card ${bond.cold ? 'cold' : ''}`}>
              <div className="bond-row">
                <span className="flame">{bond.cold ? '🕯️' : '🔥'}</span>
                <span className="bond-title">火花 Lv.{bond.level} {bond.levelName}</span>
                <span className="bond-streak">
                  {bond.cold ? '火花休息中' : `连续 ${bond.streak} 天`}
                </span>
              </div>
              <div className="spark-bar">
                <div
                  className="spark-fill"
                  style={{ width: `${sparkPct(bond)}%` }}
                />
              </div>
            </div>
          )}

          {/* 互动 Dock（陪伴 Tab） */}
          {tab === 'companion' && (
            <div className="dock">
              {DOCK.map((d) => (
                <button key={d.id} className="dock-btn" onClick={() => sendAction(d.id)}>
                  <span className="dock-emoji">{d.emoji}</span>
                  <span className="dock-label">{labelOf(d.id)}</span>
                </button>
              ))}
            </div>
          )}

          {/* 任务 Tab */}
          {tab === 'quests' && (
            <div className="panel">
              <div className={`panel-card remind ${bond?.cold ? 'cold' : ''}`}>
                {bond?.cold
                  ? '🕯️ 今天你们还没互动，火花休息中——互相任意互动 1 次即可复燃'
                  : bond
                    ? `🔥 火花正旺！已连续 ${bond.streak} 天，今天互动过了`
                    : '🤝 绑定 TA 后开启每日任务和火花养成'}
              </div>
              {quests.map((q) => (
                <div key={q.id} className={`panel-card quest ${q.rewarded ? 'rewarded' : ''}`}>
                  <div className="quest-row">
                    <span>{q.label}</span>
                    <span className={q.rewarded ? 'ok' : q.done ? 'ready' : ''}>
                      {q.rewarded ? `+${q.reward} ✓` : `${q.progress}/${q.target}`}
                    </span>
                  </div>
                  <div className="quest-bar">
                    <div style={{ width: `${(q.progress / q.target) * 100}%` }} />
                  </div>
                  <div className="quest-reward">完成 +{q.reward} 火花</div>
                </div>
              ))}
            </div>
          )}

          {/* 记录 Tab */}
          {tab === 'records' && (
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
          {tab === 'me' && (
            <div className="panel">
              <div className="panel-card">
                <h3>{me.name}</h3>
                <p className="sub">
                  {partner
                    ? `与 ${partner.name} 已绑定 ❤${bond ? ` · 火花 Lv.${bond.level} ${bond.levelName}` : ''}`
                    : '还没有绑定 TA'}
                </p>
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
              </div>
              <p className="sub center tiny">数字分身 V1.2 · 小火人化</p>
            </div>
          )}

          {/* 底部 Tab 导航 */}
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

          {/* 邀请链接弹窗 */}
          {inviteLink && (
            <div className="modal" onClick={() => setInviteLink('')}>
              <div className="modal-card" onClick={(e) => e.stopPropagation()}>
                <h3>把链接发给 TA</h3>
                <p className="link-text">{inviteLink}</p>
                <p className="sub">链接已复制。TA 打开接受后，你的分身就会住进 TA 的设备里</p>
                <button className="btn" onClick={() => setInviteLink('')}>好</button>
              </div>
            </div>
          )}

          {/* 小人菜单 */}
          {menu && (
            <div className="ctxmenu" style={{ left: menu.x, top: menu.y }}>
              {menu.target === 'partner' && (
                <>
                  <div className="ctxmenu-title">给 {partner?.name}</div>
                  {ACTIONS.map((a) => (
                    <button key={a.id} onClick={() => sendAction(a.id)}>
                      {a.label}
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

function labelOf(action: string) {
  return ACTIONS.find((a) => a.id === action)?.label ?? action
}

/** 当前等级内的火花进度（0-100），满级显示 100 */
function sparkPct(b: BondMeta) {
  if (b.nextLevelAt == null) return 100
  const curAt = LEVELS.find((l) => l.level === b.level)?.at ?? 0
  const span = b.nextLevelAt - curAt
  return Math.min(100, Math.max(3, Math.round(((b.growth - curAt) / span) * 100)))
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
