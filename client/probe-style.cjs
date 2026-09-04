/* 换色回归探针：换色前后从 PIXI canvas 提取像素统计目标色系占比 + 抓 [outfit] 日志 */
const puppeteer = require('puppeteer-core')
const path = require('path')

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
  const outfitLogs = []
  page.on('console', (m) => {
    const t = m.text()
    if (t.includes('[outfit]') || t.includes('[prefetch]')) outfitLogs.push(t.slice(0, 200))
  })
  page.on('pageerror', (e) => outfitLogs.push('PAGEERROR: ' + String(e).slice(0, 200)))
  await page.goto('http://localhost:4173/digital-avatar/', { waitUntil: 'networkidle2', timeout: 30000 })
  await new Promise((r) => setTimeout(r, 800))

  // 建号
  await page.evaluate(() => localStorage.clear())
  await page.reload({ waitUntil: 'networkidle2' })
  await new Promise((r) => setTimeout(r, 800))
  await page.type('.onboard input', '换色探针')
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

  // 色相分桶统计（提取整个舞台像素）
  const countHues = () =>
    page.evaluate(() => {
      const app = window.__pixi.app
      const px = app.renderer.plugins.extract.pixels(app.stage)
      const buckets = { blue: 0, pink: 0, purple: 0, green: 0, opaque: 0 }
      for (let i = 0; i < px.length; i += 4) {
        if (px[i + 3] < 16) continue
        buckets.opaque++
        const r = px[i] / 255, g = px[i + 1] / 255, b = px[i + 2] / 255
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b), df = mx - mn
        if (df / mx < 0.18 || mx < 0.18) continue // 低饱和/过暗不算显色
        let h = 0
        if (mx === r) h = ((g - b) / df + 6) % 6
        else if (mx === g) h = (b - r) / df + 2
        else h = (r - g) / df + 4
        h *= 60
        if (h >= 195 && h < 260) buckets.blue++
        else if (h >= 300 || h < 345) { if (h >= 300 || h < 345) buckets.pink++ }
        else if (h >= 260 && h < 300) buckets.purple++
        else if (h >= 90 && h < 160) buckets.green++
      }
      const pct = (n) => (buckets.opaque ? ((n / buckets.opaque) * 100).toFixed(2) + '%' : '0%')
      return { blue: pct(buckets.blue), pink: pct(buckets.pink), purple: pct(buckets.purple), green: pct(buckets.green) }
    })

  // 强制切 Hiyori（女色板）固定基准
  await page.evaluate(() => {
    ;[...document.querySelectorAll('.style-chip')].find((b) => b.textContent.includes('Hiyori'))?.click()
  })
  await new Promise((r) => setTimeout(r, 5000))
  outfitLogs.length = 0
  const hiyoriBase = await countHues()
  console.log('HIYORI base:', JSON.stringify(hiyoriBase))

  // 点 海盐蓝
  await page.evaluate(() => {
    ;[...document.querySelectorAll('.style-chip')].find((b) => b.textContent.includes('海盐蓝'))?.click()
  })
  await new Promise((r) => setTimeout(r, 6000))
  const hiyoriBlue = await countHues()
  console.log('HIYORI seablue:', JSON.stringify(hiyoriBlue))

  // 点 樱花粉
  await page.evaluate(() => {
    ;[...document.querySelectorAll('.style-chip')].find((b) => b.textContent.includes('樱花粉'))?.click()
  })
  await new Promise((r) => setTimeout(r, 6000))
  const hiyoriPink = await countHues()
  console.log('HIYORI sakura:', JSON.stringify(hiyoriPink))

  console.log('--- [outfit] logs (hiyori round) ---')
  outfitLogs.forEach((l) => console.log('  ' + l))

  // 切 Chitose（男色板）再测 军绿
  outfitLogs.length = 0
  await page.evaluate(() => {
    ;[...document.querySelectorAll('.style-chip')].find((b) => b.textContent.includes('Chitose'))?.click()
  })
  await new Promise((r) => setTimeout(r, 6000))
  const chBase = await countHues()
  console.log('CHITOSE base:', JSON.stringify(chBase))
  await page.evaluate(() => {
    ;[...document.querySelectorAll('.style-chip')].find((b) => b.textContent.includes('军绿'))?.click()
  })
  await new Promise((r) => setTimeout(r, 6000))
  const chGreen = await countHues()
  console.log('CHITOSE armygreen:', JSON.stringify(chGreen))
  console.log('--- [outfit] logs (chitose round) ---')
  outfitLogs.forEach((l) => console.log('  ' + l))

  await page.screenshot({ path: path.join(__dirname, 'shots', 'probe-style-final.png') })
  await browser.close()
})().catch((e) => { console.error('PROBE FAIL:', e); process.exit(1) })
