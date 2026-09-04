/* V1.5.0 验证：Chitose 形象接入 + Mark 回退迁移 + 男色板 + 性别过滤 + 版权声明 */
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
  const openWardrobe = async (page) => {
    await page.evaluate(() => document.querySelectorAll('.tabbar .tab')[3]?.click()) // 我的
    await new Promise((r) => setTimeout(r, 500))
  }
  const chipLabels = async (page) =>
    page.evaluate(() =>
      [...document.querySelectorAll('.wardrobe-row')]
        .map((row) => [...row.querySelectorAll('.style-chip .style-label')].map((el) => el.textContent)),
    )

  // ---- T1: 建号 + 切到 Chitose 形象 ----
  const pa = await mkPage()
  const A = await onboard(pa, '阿泰')
  console.log('T1 A:', A.id, 'initial avatar =', A.avatar)
  await openWardrobe(pa)
  await pa.evaluate(() => {
    ;[...document.querySelectorAll('.style-chip')].find((b) => b.textContent.includes('Chitose'))?.click()
  })
  await new Promise((r) => setTimeout(r, 4000)) // 模型重载余量
  const t1 = await pa.evaluate(() => ({
    avatar: JSON.parse(localStorage.getItem('da_me')).avatar,
    hasModel: !!window.__pixi.meS.model,
  }))
  console.log('T1 SWITCH:', JSON.stringify(t1))
  await pa.screenshot({ path: path.join(SHOTS, 'v150-chitose-default.png') })

  // ---- T2: 男色板可见性（Chitose 应显示 军绿/藏青/炭灰，无 樱花粉） ----
  const t2 = await chipLabels(pa)
  console.log('T2 FEMALE→MALE rows:', JSON.stringify(t2))
  const hasMale = t2[1]?.some((l) => ['军绿', '藏青', '炭灰'].some((k) => l.includes(k)))
  const noFemale = !t2[1]?.some((l) => ['樱花粉', '海盐蓝', '元气橙', '暗夜紫'].some((k) => l.includes(k)))
  console.log('T2 RESULT: malePalette=', hasMale, 'femaleHidden=', noFemale)

  // ---- T3: 藏青换色（重染管线 + 白名单矩形） ----
  await pa.evaluate(() => {
    ;[...document.querySelectorAll('.style-chip')].find((b) => b.textContent.includes('藏青'))?.click()
  })
  await new Promise((r) => setTimeout(r, 4000))
  const t3 = await pa.evaluate(() => ({
    style: localStorage.getItem('da_style'),
    hasModel: !!window.__pixi.meS.model,
  }))
  console.log('T3 NAVY:', JSON.stringify(t3))
  await pa.screenshot({ path: path.join(SHOTS, 'v150-chitose-navy.png') })

  // ---- T4: 互动仍有动作反馈（Chitose TapBody 组） ----
  await pa.evaluate(() => document.querySelectorAll('.tabbar .tab')[0]?.click()) // 陪伴 tab
  await new Promise((r) => setTimeout(r, 500))
  await pa.evaluate(() => document.querySelectorAll('.dock-btn')[0]?.click()) // 喂食
  await new Promise((r) => setTimeout(r, 2600))
  const t4 = await pa.evaluate(() => ({
    bubble: document.querySelector('.bubble')?.textContent ?? null,
    motion: !!window.__pixi.meS.model.internalModel.motionManager.state,
  }))
  console.log('T4 FEED:', JSON.stringify(t4))

  // ---- T5: localStorage 残留 mark → 回退默认形象 ----
  const pb = await mkPage()
  await pb.evaluate(() => localStorage.clear())
  const uid = await pb.evaluate(async () => {
    const r = await (await fetch('/digital-avatar/api/identity', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '迁移测试' }),
    })).json()
    localStorage.setItem('da_me', JSON.stringify({ ...r.user, avatar: 'mark' }))
    return r.user.id
  })
  await pb.reload({ waitUntil: 'networkidle2' })
  if (!(await waitModel(pb))) throw new Error('mark-migration model not loaded')
  await new Promise((r) => setTimeout(r, 2500)) // getState 对齐服务端 avatar 后可能二次换装
  const t5 = await pb.evaluate(() => ({
    local: JSON.parse(localStorage.getItem('da_me')).avatar,
    serverAvatar: null,
    hasModel: !!window.__pixi.meS.model,
  }))
  t5.serverAvatar = await pb.evaluate(async (u) => (await (await fetch('/digital-avatar/api/identity/' + u)).json()).user.avatar, uid)
  console.log('T5 MARK_FALLBACK:', JSON.stringify(t5))

  // ---- T6: 版权声明（在"我的"tab 面板里） ----
  await openWardrobe(pa)
  const t6 = await pa.evaluate(() => document.body.textContent.includes('This content uses sample data owned and copyrighted by Live2D Inc.'))
  console.log('T6 COPYRIGHT_NOTICE:', t6)

  console.log('CONSOLE_ERRORS:', JSON.stringify(errors.slice(0, 8)))
  await browser.close()
})().catch((e) => { console.error('FATAL', e); process.exit(1) })
