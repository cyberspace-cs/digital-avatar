/* V1.3.2 拖拽/长按/换形象 确定性 E2E（puppeteer-core + 本机 Edge，CDP 真实输入） */
const puppeteer = require('puppeteer-core')

;(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: 'new',
    args: ['--window-size=420,860', '--force-device-scale-factor=2'],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 412, height: 850, deviceScaleFactor: 2 })
  const errors = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)) })
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + String(e).slice(0, 160)))

  await page.goto('http://localhost:4173/digital-avatar/', { waitUntil: 'networkidle2', timeout: 30000 })
  await new Promise((r) => setTimeout(r, 1500))

  // 清状态 → 重建身份
  await page.evaluate(() => { localStorage.clear(); return 'ok' })
  await page.reload({ waitUntil: 'networkidle2' })
  await new Promise((r) => setTimeout(r, 1200))
  const hasOnboard = await page.evaluate(() => !!document.querySelector('.onboard input'))
  if (hasOnboard) {
    await page.type('.onboard input', 'DragTest')
    await page.click('.onboard button')
  }
  // 等模型加载
  let ok = false
  for (let i = 0; i < 20; i++) {
    ok = await page.evaluate(() => !!(window.__pixi && window.__pixi.meS && window.__pixi.meS.model))
    if (ok) break
    await new Promise((r) => setTimeout(r, 500))
  }
  console.log('MODEL_LOADED:', ok)
  // 等身份写入 localStorage（createUser 异步）
  let user = null
  for (let i = 0; i < 15; i++) {
    user = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('da_me')) } catch (_e) { return null } })
    if (user) break
    if (i === 2 || i === 6) {
      const st = await page.evaluate(() => JSON.stringify({
        onboard: !!document.querySelector('.onboard'),
        toast: document.querySelector('.toast')?.textContent ?? null,
      }))
      console.log('WAIT' + i + ':', st)
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  console.log('USER:', JSON.stringify(user))
  if (!ok) { console.log('CONSOLE_ERRORS:', JSON.stringify(errors)); await browser.close(); return }

  const info = await page.evaluate(() => {
    const s = window.__pixi.meS
    const b = s.model.getBounds(false)
    return JSON.stringify({
      avatar: JSON.parse(localStorage.getItem('da_me')).avatar,
      modelX: Math.round(s.model.x), modelY: Math.round(s.model.y),
      bx: Math.round(b.x), by: Math.round(b.y), bw: Math.round(b.width), bh: Math.round(b.height),
      vw: innerWidth, vh: innerHeight,
    })
  })
  console.log('INFO:', info)
  const { bx, by, bw, bh } = JSON.parse(info)
  const cx = bx + bw / 2, cy = by + bh * 0.55 // 胸口位置，一定在角色身上

  // ---- 拖拽：CDP 真实鼠标输入 ----
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  for (let i = 1; i <= 6; i++) {
    await page.mouse.move(cx + i * 40, cy + i * 8, { steps: 2 })
    await new Promise((r) => setTimeout(r, 40))
  }
  await new Promise((r) => setTimeout(r, 120))
  const duringX = await page.evaluate(() => Math.round(window.__pixi.meS.model.x))
  await page.mouse.up()
  await new Promise((r) => setTimeout(r, 300))
  const after = await page.evaluate(() => Math.round(window.__pixi.meS.model.x))
  console.log('DRAG: startX=' + Math.round(cx) + ' duringX=' + duringX + ' afterX=' + after + ' delta=' + (after - Math.round(cx)))

  // ---- 单击互动（poke）----
  const cxCur = await page.evaluate(() => { const b = window.__pixi.meS.model.getBounds(false); return Math.round(b.x + b.width / 2) })
  const cyCur = await page.evaluate(() => { const b = window.__pixi.meS.model.getBounds(false); return Math.round(b.y + b.height * 0.55) })
  await page.mouse.click(cxCur, cyCur)
  await new Promise((r) => setTimeout(r, 500))
  const tapped = await page.evaluate(() => !!window.__pixi.meS.model.internalModel.motionManager.state)
  console.log('TAP_MOTION:', tapped)

  // ---- 长按菜单 ----
  await page.mouse.move(cxCur, cyCur)
  await page.mouse.down()
  await new Promise((r) => setTimeout(r, 750))
  const menuUp = await page.evaluate(() => !!document.querySelector('.ctxmenu'))
  await page.mouse.up()
  console.log('LONGPRESS_MENU:', menuUp)
  if (menuUp) await page.evaluate(() => document.querySelector('.ctxmenu-close')?.click())

  // ---- 换形象 ----
  await page.evaluate(() => document.querySelectorAll('.tabbar .tab')[3].click())
  await new Promise((r) => setTimeout(r, 800))
  const curAvatar = await page.evaluate(() => JSON.parse(localStorage.getItem('da_me')).avatar)
  const target = curAvatar === 'haru' ? 'natori' : 'haru'
  const chips = await page.$$('.wardrobe-row .style-chip')
  // 形象区是第一个 wardrobe-row：Hiyori/Natori/Haru
  let clicked = null
  for (const c of chips) {
    const label = await c.evaluate((el) => el.textContent)
    if (label.includes(target === 'haru' ? 'Haru' : 'Natori')) { await c.click(); clicked = label; break }
  }
  const earlyToast = await page.evaluate(() => document.querySelector('.toast')?.textContent ?? null)
  await new Promise((r) => setTimeout(r, 8000))
  const swapRes = await page.evaluate(() => JSON.stringify({
    avatar: JSON.parse(localStorage.getItem('da_me')).avatar,
    toast: document.querySelector('.toast')?.textContent ?? null,
    hasModel: !!window.__pixi.meS.model,
  }))
  console.log('SWAP: clicked=' + clicked + ' earlyToast=' + earlyToast + ' after=' + swapRes)

  // ---- 互动按钮气泡（回归）----
  await page.click('.tabbar .tab') // 回陪伴页? 第一个 tab 是陪伴
  const dockBtns = await page.$$('.dock-btn')
  if (dockBtns.length >= 4) { await dockBtns[3].click() } // 🤗 抱抱
  await new Promise((r) => setTimeout(r, 600))
  const bubble = await page.evaluate(() => document.querySelector('.bubble')?.textContent ?? null)
  console.log('HUG_BUBBLE:', bubble)

  console.log('CONSOLE_ERRORS:', JSON.stringify(errors))
  await browser.close()
})().catch((e) => { console.error('FATAL', e); process.exit(1) })
