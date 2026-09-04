/* V1.4.3 换装校准 E2E：4 模型 × 3 风格，逐组合截图（puppeteer-core + 本机 Edge） */
const puppeteer = require('puppeteer-core')
const fs = require('fs')
const path = require('path')

const AVATARS = ['hiyori', 'haru', 'natori', 'mark']
const STYLES = ['default', 'sakura', 'ocean']
const OUT_DIR = path.join(__dirname, 'shots')

;(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: 'new',
    args: ['--window-size=420,860', '--force-device-scale-factor=2'],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 412, height: 850, deviceScaleFactor: 2 })
  const errors = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)) })
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + String(e).slice(0, 200)))

  await page.goto('http://localhost:4173/digital-avatar/', { waitUntil: 'networkidle2', timeout: 30000 })
  await new Promise((r) => setTimeout(r, 1000))
  await page.evaluate(() => localStorage.clear())
  await page.reload({ waitUntil: 'networkidle2' })
  await new Promise((r) => setTimeout(r, 1000))
  if (await page.evaluate(() => !!document.querySelector('.onboard input'))) {
    await page.type('.onboard input', 'Calib')
    await page.click('.onboard button')
  }
  // 等身份 + 首个模型
  for (let i = 0; i < 30; i++) {
    const ready = await page.evaluate(() => {
      let u = null
      try { u = JSON.parse(localStorage.getItem('da_me')) } catch (_e) { /* ignore */ }
      return !!(u && window.__pixi && window.__pixi.meS && window.__pixi.meS.model)
    })
    if (ready) break
    await new Promise((r) => setTimeout(r, 500))
  }
  const me = await page.evaluate(() => JSON.parse(localStorage.getItem('da_me')))
  console.log('ME:', me.id, me.avatar)

  for (const avatar of AVATARS) {
    for (const style of STYLES) {
      // 服务端设置形象+风格 → localStorage 同步 → reload 后初始加载即目标组合（单次加载）
      await page.evaluate(async (uid, avatar, style) => {
        await fetch('/digital-avatar/api/state', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: uid, avatar, style }),
        })
        const u = JSON.parse(localStorage.getItem('da_me'))
        u.avatar = avatar
        localStorage.setItem('da_me', JSON.stringify(u))
        localStorage.setItem('da_style', style)
      }, me.id, avatar, style)
      await page.reload({ waitUntil: 'networkidle2' })
      let ok = false
      for (let i = 0; i < 30; i++) {
        ok = await page.evaluate(() => !!(window.__pixi?.meS?.model))
        if (ok) break
        await new Promise((r) => setTimeout(r, 500))
      }
      // 等首帧渲染稳定
      await new Promise((r) => setTimeout(r, 2500))
      const el = await page.$('.canvas-host')
      if (el) await el.screenshot({ path: path.join(OUT_DIR, `${avatar}-${style}.png`) })
      console.log('SHOT:', `${avatar}-${style}`, 'loaded=' + ok)
    }
  }
  console.log('CONSOLE_ERRORS:', JSON.stringify(errors.slice(0, 10)))
  await browser.close()
})().catch((e) => { console.error('FATAL', e); process.exit(1) })
