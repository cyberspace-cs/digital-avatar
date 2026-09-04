/* V1.4.3 综合验证：互动闭环（socket + REST 兜底）+ 桌宠模式 + 形象库两男两女 */
const puppeteer = require('puppeteer-core')
const path = require('path')

const SHOTS = path.join(__dirname, 'shots')

;(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: 'new',
    protocolTimeout: 300000,
    args: ['--window-size=420,860', '--force-device-scale-factor=2'],
  })
  const errors = []
  // V1.4.3 修复：每个页面用独立 incognito context——同一 context 共享 localStorage，
  // 两个页面 reload 后会变成同一个身份（表现为 feed 的 sender 全是 B、火花不结算）
  const mkPage = async () => {
    const ctx = await browser.createBrowserContext()
    const page = await ctx.newPage()
    await page.setViewport({ width: 412, height: 850, deviceScaleFactor: 2 })
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)) })
    page.on('pageerror', (e) => errors.push('PAGEERROR: ' + String(e).slice(0, 160)))
    await page.goto('http://localhost:4173/digital-avatar/', { waitUntil: 'networkidle2', timeout: 30000 })
    await new Promise((r) => setTimeout(r, 800))
    return page
  }
  const waitModel = async (page) => {
    for (let i = 0; i < 30; i++) {
      const ok = await page.evaluate(() => {
        let u = null
        try { u = JSON.parse(localStorage.getItem('da_me')) } catch (_e) { return false }
        return !!(u && window.__pixi && window.__pixi.meS && window.__pixi.meS.model)
      })
      if (ok) return true
      await new Promise((r) => setTimeout(r, 500))
    }
    return false
  }
  const onboard = async (page, name) => {
    await page.evaluate(() => localStorage.clear())
    await page.reload({ waitUntil: 'networkidle2' })
    await new Promise((r) => setTimeout(r, 800))
    await page.type('.onboard input', name)
    await page.click('.onboard button')
    if (!(await waitModel(page))) throw new Error('model not loaded for ' + name)
    return page.evaluate(() => JSON.parse(localStorage.getItem('da_me')))
  }
  const bondOf = async (page, uid) =>
    page.evaluate(async (u) => (await (await fetch(`/digital-avatar/api/bond/${u}`)).json()).bond, uid)

  // ---- A、B 建号 ----
  const pa = await mkPage()
  const A = await onboard(pa, '阿泰')
  const pb = await mkPage()
  const B = await onboard(pb, '小美')
  console.log('A:', A.id, A.avatar, '| B:', B.id, B.avatar)

  // ---- 绑定：A 生成邀请，B 用 fetch 接受 ----
  await pa.evaluate(async (uid) => {
    const r = await (await fetch('/digital-avatar/api/invite', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: uid }),
    })).json()
    localStorage.setItem('e2e_invite', r.code)
  }, A.id)
  const code = await pa.evaluate(() => localStorage.getItem('e2e_invite'))
  await pb.evaluate(async (u, c) => {
    const r = await fetch(`/digital-avatar/api/invite/${c}/accept`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: u.id }),
    })
    console.log('accept status', r.status)
  }, B, code)
  await Promise.all([pa.reload({ waitUntil: 'networkidle2' }), pb.reload({ waitUntil: 'networkidle2' })])
  await waitModel(pa)
  await waitModel(pb)
  await new Promise((r) => setTimeout(r, 1000))
  const bondBefore = await bondOf(pa, A.id)
  console.log('BOUND. bondBefore=', JSON.stringify(bondBefore))

  // ---- A 喂食 → socket 闭环（动作 + 气泡 + 火花）----
  await pa.evaluate(() => document.querySelector('.tabbar .tab')?.click()) // 陪伴 tab
  await new Promise((r) => setTimeout(r, 500))
  // ElementHandle.click 在 headless 下会因稳定性等待超时，直接 DOM click
  await pa.evaluate(() => document.querySelectorAll('.dock-btn')[0]?.click()) // 喂食
  // 1.6s REST 兜底窗口 + 结算/推送余量
  await new Promise((r) => setTimeout(r, 2600))
  const bubbleA = await pa.evaluate(() => document.querySelector('.bubble')?.textContent ?? null)
  const motionA = await pa.evaluate(() => !!window.__pixi.meS.model.internalModel.motionManager.state)
  const bondAfterFeed = await bondOf(pa, A.id)
  console.log('FEED: bubble=', bubbleA, 'motion=', motionA, 'growth=', bondBefore?.growth, '→', bondAfterFeed?.growth)
  // B 端应收到互动（对方分身播放动作/气泡）
  const bubbleB = await pb.evaluate(() => document.querySelector('.bubble')?.textContent ?? null)
  console.log('B_RECEIVED bubble=', bubbleB)

  // ---- REST 兜底：直调 /api/interact 送花（幂等，接收方=真实 partner B）----
  const restRes = await pa.evaluate(async (uid, rid) => {
    const post = (eventId) => fetch('/digital-avatar/api/interact', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ senderId: uid, receiverId: rid, action: 'flower', eventId }),
    }).then((r) => r.json())
    const eid = 'e2e-rest-' + Date.now() // eventId 必须每次运行唯一，否则撞历史幂等记录
    const r1 = await post(eid)
    const r2 = await post(eid) // 同 eventId 重放 → 必须去重
    return { r1, r2 }
  }, A.id, B.id)
  console.log('REST: delta=', restRes.r1.growth?.delta, 'replayDuplicate=', restRes.r2.duplicate)
  const bondAfterRest = await bondOf(pa, A.id)
  console.log('GROWTH chain:', bondBefore?.growth, '→', bondAfterFeed?.growth, '→', bondAfterRest?.growth)

  // ---- 桌宠模式 ----
  await pa.evaluate(() => document.querySelectorAll('.tabbar .tab')[3].click()) // 我的
  await new Promise((r) => setTimeout(r, 400))
  await pa.evaluate(() => {
    ;[...document.querySelectorAll('button')].find((b) => b.textContent.includes('桌宠模式'))?.click()
  })
  await new Promise((r) => setTimeout(r, 600))
  const petState = await pa.evaluate(() => JSON.stringify({
    space: document.querySelector('.space')?.className,
    topbar: !!document.querySelector('.topbar'),
    tabbar: !!document.querySelector('.tabbar'),
    petDock: !!document.querySelector('.pet-dock'),
    petExit: !!document.querySelector('.pet-exit'),
    hasModel: !!window.__pixi.meS.model,
  }))
  console.log('PETMODE:', petState)
  // ElementHandle.screenshot 内部 evaluate 会超时，改整页截图
  await pa.screenshot({ path: path.join(SHOTS, 'petmode.png') })
  await pa.evaluate(() => document.querySelectorAll('.pet-dock .dock-btn')[0]?.click())
  await new Promise((r) => setTimeout(r, 800))
  const petBubble = await pa.evaluate(() => document.querySelector('.bubble')?.textContent ?? null)
  console.log('PET_FEED_BUBBLE:', petBubble)
  await pa.evaluate(() => document.querySelector('.pet-exit')?.click())
  await new Promise((r) => setTimeout(r, 400))
  const restored = await pa.evaluate(() => JSON.stringify({
    topbar: !!document.querySelector('.topbar'),
    tabbar: !!document.querySelector('.tabbar'),
    petDock: !!document.querySelector('.pet-dock'),
  }))
  console.log('PET_EXIT:', restored)

  console.log('CONSOLE_ERRORS:', JSON.stringify(errors.slice(0, 8)))
  await browser.close()
})().catch((e) => { console.error('FATAL', e); process.exit(1) })
