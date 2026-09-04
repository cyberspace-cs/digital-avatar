/* 竞态探针：快速连点两个颜色，检查最终像素颜色与最终 state 是否一致 */
const puppeteer = require('puppeteer-core')

;(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: 'new',
    protocolTimeout: 300000,
    args: ['--window-size=420,860', '--force-device-scale-factor=2'],
  })
  const ctx = await browser.createBrowserContext()
  const page = await ctx.newPage()
  await page.setViewport({ width: 412, height: 850, deviceScaleFactor: 2 })
  const logs = []
  page.on('console', (m) => {
    const t = m.text()
    if (t.includes('[outfit]') || t.includes('[load]')) logs.push(t.slice(0, 150))
  })
  await page.goto('http://localhost:4173/digital-avatar/', { waitUntil: 'networkidle2', timeout: 30000 })
  await new Promise((r) => setTimeout(r, 800))
  await page.evaluate(() => localStorage.clear())
  await page.reload({ waitUntil: 'networkidle2' })
  await new Promise((r) => setTimeout(r, 800))
  await page.type('.onboard input', '竞态探针')
  await page.click('.onboard button')
  for (let i = 0; i < 30; i++) {
    const ok = await page.evaluate(() => {
      let u = null
      try { u = JSON.parse(localStorage.getItem('da_me')) } catch (_e) { return false }
      return !!(u && window.__pixi && window.__pixi.meS && window.__pixi.meS.model)
    })
    if (ok) break
    await new Promise((r) => setTimeout(r, 500))
  }
  await page.evaluate(() => document.querySelectorAll('.tabbar .tab')[3]?.click())
  await new Promise((r) => setTimeout(r, 500))

  const countHues = () =>
    page.evaluate(() => {
      const app = window.__pixi.app
      const px = app.renderer.plugins.extract.pixels(app.stage)
      let blue = 0, pink = 0, opaque = 0
      for (let i = 0; i < px.length; i += 4) {
        if (px[i + 3] < 16) continue
        opaque++
        const r = px[i] / 255, g = px[i + 1] / 255, b = px[i + 2] / 255
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b), df = mx - mn
        if (df / mx < 0.18 || mx < 0.18) continue
        let h = 0
        if (mx === r) h = ((g - b) / df + 6) % 6
        else if (mx === g) h = (b - r) / df + 2
        else h = (r - g) / df + 4
        h *= 60
        if (h >= 195 && h < 260) blue++
        else if (h >= 300 || h < 345) pink++
      }
      const pct = (n) => (opaque ? ((n / opaque) * 100).toFixed(1) + '%' : '0%')
      return { blue: pct(blue), pink: pct(pink) }
    })

  // 固定 Hiyori + 回到原生
  await page.evaluate(() => {
    ;[...document.querySelectorAll('.style-chip')].find((b) => b.textContent.includes('Hiyori'))?.click()
  })
  await new Promise((r) => setTimeout(r, 6000))
  await page.evaluate(() => {
    ;[...document.querySelectorAll('.style-chip')].find((b) => b.textContent.includes('原生'))?.click()
  })
  await new Promise((r) => setTimeout(r, 6000))
  console.log('BASE:', JSON.stringify(await countHues()))

  // 场景1：慢速切换（基准）海盐蓝 → 等 6s → 樱花粉
  await page.evaluate(() => {
    ;[...document.querySelectorAll('.style-chip')].find((b) => b.textContent.includes('海盐蓝'))?.click()
  })
  await new Promise((r) => setTimeout(r, 6000))
  await page.evaluate(() => {
    ;[...document.querySelectorAll('.style-chip')].find((b) => b.textContent.includes('樱花粉'))?.click()
  })
  await new Promise((r) => setTimeout(r, 8000))
  const slow = { pixels: await countHues(), state: await page.evaluate(() => localStorage.getItem('da_style')), models: await page.evaluate(() => window.__pixi.meS.model ? 1 : 0) }
  console.log('SLOW pink final:', JSON.stringify(slow))

  // 回原生
  await page.evaluate(() => {
    ;[...document.querySelectorAll('.style-chip')].find((b) => b.textContent.includes('原生'))?.click()
  })
  await new Promise((r) => setTimeout(r, 6000))

  // 场景2：快速连点（模拟用户 2-5s 间隔连点）海盐蓝 → 1.2s → 樱花粉 → 1.2s → 海盐蓝
  logs.length = 0
  await page.evaluate(() => {
    ;[...document.querySelectorAll('.style-chip')].find((b) => b.textContent.includes('海盐蓝'))?.click()
  })
  await new Promise((r) => setTimeout(r, 1200))
  await page.evaluate(() => {
    ;[...document.querySelectorAll('.style-chip')].find((b) => b.textContent.includes('樱花粉'))?.click()
  })
  await new Promise((r) => setTimeout(r, 1200))
  await page.evaluate(() => {
    ;[...document.querySelectorAll('.style-chip')].find((b) => b.textContent.includes('海盐蓝'))?.click()
  })
  await new Promise((r) => setTimeout(r, 12000)) // 等所有竞态跑完
  const fast = { pixels: await countHues(), state: await page.evaluate(() => localStorage.getItem('da_style')) }
  console.log('FAST seablue final:', JSON.stringify(fast))
  console.log('--- load/outfit logs (fast round) ---')
  logs.forEach((l) => console.log('  ' + l))

  await browser.close()
})().catch((e) => { console.error('PROBE FAIL:', e); process.exit(1) })
