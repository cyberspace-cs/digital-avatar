import React, { useEffect, useRef, useState, useCallback } from 'react'
import * as PIXI from 'pixi.js'
import './pixi-setup'
import { AvatarSprite } from './live2d/avatar'
import { api } from './api'
import { connectSocket, emit, getSocket } from './socket'
import type { InteractionEvent, Mood, User, Visibility } from './types'

// 模型路径需带 base 前缀（生产部署在 /digital-avatar/ 子路径下）
const BASE = import.meta.env.BASE_URL
const MY_MODEL = `${BASE}models/hiyori/Hiyori.model3.json`
const PARTNER_MODEL = `${BASE}models/natori/Natori.model3.json`
const MODEL_SCALE = 0.12

type MenuPos = { x: number; y: number; target: 'me' | 'partner' } | null

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
]

export default function App() {
  const canvasHost = useRef<HTMLDivElement>(null)
  const appRef = useRef<PIXI.Application | null>(null)
  const meSprite = useRef<AvatarSprite | null>(null)
  const partnerSprite = useRef<AvatarSprite | null>(null)

  const [me, setMe] = useState<User | null>(null)
  const [partner, setPartner] = useState<User | null>(null)
  const [nickname, setNickname] = useState('')
  const [mood, setMood] = useState<Mood>('neutral')
  const [visibility, setVisibility] = useState<Visibility>('public')
  const [menu, setMenu] = useState<MenuPos>(null)
  const [events, setEvents] = useState<InteractionEvent[]>([])
  const [showRecords, setShowRecords] = useState(false)
  const [showMoodPicker, setShowMoodPicker] = useState(false)
  const [bubble, setBubble] = useState<{ who: 'me' | 'partner'; text: string } | null>(null)
  const [hearts, setHearts] = useState<{ id: number; x: number; y: number }[]>([])
  const [partnerOnline, setPartnerOnline] = useState(false)
  const [inviteLink, setInviteLink] = useState('')
  const [toast, setToast] = useState('')

  const stateRef = useRef({ mood, visibility, me, partner })
  stateRef.current = { mood, visibility, me, partner }

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
          location.href = location.origin
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
      antialias: true,
    })
    canvasHost.current.appendChild(app.view as HTMLCanvasElement)
    appRef.current = app

    const meS = new AvatarSprite()
    const partnerS = new AvatarSprite()
    meSprite.current = meS
    partnerSprite.current = partnerS

    Promise.all([
      meS.load(app.stage, MY_MODEL, MODEL_SCALE),
      partnerS.load(app.stage, PARTNER_MODEL, MODEL_SCALE),
    ]).then(() => {
      partnerS.model!.visible = false
      meS.setPosition(window.innerWidth * 0.35, window.innerHeight * 0.78)
      partnerS.setPosition(window.innerWidth * 0.65, window.innerHeight * 0.78)
      bindDrag(meS, 'me')
      bindDrag(partnerS, 'partner')
        ; (window as any).__stageReady = true
    })

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

  // ---------- 绑定后显示对方分身 ----------
  useEffect(() => {
    if (partner && partnerSprite.current?.model) {
      partnerSprite.current.model.visible = true
    }
  }, [partner])

  // ---------- 拖拽 + 边缘姿态 ----------
  const bindDrag = (sprite: AvatarSprite, who: 'me' | 'partner') => {
    let dragging = false
    let moved = 0
    let last = { x: 0, y: 0 }
    const model = sprite.model!
    model.on('pointerdown', (e: PIXI.InteractionEvent) => {
      dragging = true
      moved = 0
      last = e.data.global.clone()
    })
    const onMove = (e: PointerEvent) => {
      if (!dragging) return
      moved += Math.abs(e.movementX) + Math.abs(e.movementY)
      const nx = Math.min(window.innerWidth - 60, Math.max(60, model.x + e.movementX))
      const ny = Math.min(window.innerHeight - 40, Math.max(120, model.y + e.movementY))
      model.x = nx
      model.y = ny
    }
    const onUp = (e: PointerEvent) => {
      if (!dragging) return
      dragging = false
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
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    model.on('rightdown', (e: PIXI.InteractionEvent) => {
      e.data.originalEvent.preventDefault()
      setMenu({ x: e.data.global.x, y: e.data.global.y, target: who })
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

  // ---------- 心形粒子 ----------
  const spawnHearts = (x: number, y: number, n = 6) => {
    const items = Array.from({ length: n }, (_, i) => ({
      id: Date.now() + i,
      x: x + (Math.random() - 0.5) * 120,
      y: y + (Math.random() - 0.5) * 60,
    }))
    setHearts((h) => [...h, ...items])
    setTimeout(() => setHearts((h) => h.filter((i) => !items.includes(i))), 2600)
  }

  // ---------- 发送互动 ----------
  const sendAction = useCallback((action: string, message?: string) => {
    const cur = stateRef.current
    if (!cur.me || !cur.partner) return
    emit('interaction', {
      senderId: cur.me.id,
      receiverId: cur.partner.id,
      action,
      message: message ?? null,
    })
    // 本地立即播放发送方反馈（自己的分身做一个示意动作）
    meSprite.current?.play('wave')
    if (action === 'heart' || action === 'hug') {
      const s = partnerSprite.current
      if (s) spawnHearts(s.x, s.y - 260)
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
      if (ev.action === 'heart') spawnHearts(sprite.x, sprite.y - 260)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---------- Socket 生命周期 ----------
  useEffect(() => {
    if (!me) return
    connectSocket(me.id, {
      interaction: handleIncoming,
      partner_online: (online: boolean) => setPartnerOnline(online),
      state_update: (s: any) => {
        // 只在对方公开状态时展示
        if (s.visibility === 'public') {
          setPartnerMood(s.mood)
        }
      },
    })
    api.getPartner(me.id).then((r) => r.partner && setPartner(r.partner))
    api.getState(me.id).then((r) => {
      if (r.state) {
        setMood(r.state.mood)
        setVisibility(r.state.visibility)
      }
    })
    api.getEvents(me.id).then((r) => setEvents(r.events))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me])

  const [partnerMood, setPartnerMood] = useState<Mood | null>(null)

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
      setTimeout(() => (location.href = location.origin), 1200)
    }
  }

  // ---------- 生成邀请 ----------
  const makeInvite = async () => {
    if (!me) return
    const { code } = await api.createInvite(me.id)
    const link = `${location.origin}?invite=${code}`
    setInviteLink(link)
    navigator.clipboard?.writeText(link).catch(() => { })
  }

  const sendShortMessage = (text: string) => {
    if (!text.trim()) return
    sendAction('wave', text.trim())
    setMenu(null)
  }

  // ================= 渲染 =================
  // canvas-host 必须常驻：PIXI 初始化 effect 只在挂载时跑一次
  if (!me) {
    return (
      <div className="space">
        <div ref={canvasHost} className="canvas-host" />
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
      </div>
    )
  }

  return (
    <div className="space">
      <div ref={canvasHost} className="canvas-host" />

      {/* 顶栏 */}
      <div className="topbar">
        <div className="brand">数字分身</div>
        <div className="topbar-right">
          {partner ? (
            <span className="chip">
              {partner.name} {partnerOnline ? '🟢 在线' : '⚪ 离线'}
              {partnerMood && partnerMood !== 'neutral' && ` · ${MOOD_LABELS[partnerMood]}`}
            </span>
          ) : (
            <button className="btn ghost" onClick={makeInvite}>把我的分身送给 TA</button>
          )}
          <button className="btn ghost" onClick={() => setShowMoodPicker(true)}>
            我的状态：{MOOD_LABELS[mood]}
          </button>
          <button className="btn ghost" onClick={() => setShowRecords(true)}>互动记录</button>
        </div>
      </div>

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

      {/* 互动记录 */}
      {showRecords && (
        <div className="records-panel">
          <div className="records-head">
            <h3>互动记录</h3>
            <button className="btn ghost" onClick={() => setShowRecords(false)}>×</button>
          </div>
          {events.length === 0 && <p className="sub">还没有互动，去戳戳 TA 吧</p>}
          <ul>
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

      {/* 短句气泡 */}
      {bubble && (
        <div className={`bubble ${bubble.who}`}>{bubble.text}</div>
      )}

      {/* 心形粒子 */}
      {hearts.map((h) => (
        <div key={h.id} className="heart" style={{ left: h.x, top: h.y }}>
          💛
        </div>
      ))}

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

function labelOf(action: string) {
  return ACTIONS.find((a) => a.id === action)?.label ?? action
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
