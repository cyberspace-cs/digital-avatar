/* 生产环境换色探针：与本地 probe-style 相同逻辑，但打 https://taoxie.vip */
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
  const outfitLogs = []
  page.on('console', (m) => {
    const t = m.text()
    if (t.includes('[outfit]') || t.includes('[prefetch]') || t.includes('重染')) outfitLogs.push(t.slice(0, 220))
  })
  page.on('pageerror', (e) => outfitLogs.push('PAGEERROR: ' + String(e).slice(0, 220)))
  page.on('requestfailed', (r) => outfitLogs.push('REQFAIL: ' + r.url().slice(-80) + ' ' + (r.failure()?.errorText ?? '')))
  await page.goto('https://taoxie.vip/digital-avatar/', { waitUntil: 'networkidle2', timeout: 60000 })
  await new Promise((r) => setTimeout(r, 1500))

  await page.evaluate(() => localStorage.clear())
  await page.reload({ waitUntil: 'networkidle2', timeout: 60000 })
  await new Promise((r) => setTimeout(r, 1500))
  await page.type('.onboard input', '生产探针')
  await page.click('.onboard button')
  for (let i = 0; i < 60; i++) {
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
      const buckets = { blue: 0, green: 0, warm: 0, other: 0, opaque: 0 }
      for (let i = 0; i < px.length; i += 4) {
        if (px[i + 3] < 16) continue
        buckets.opaque++
        const r = px[i] / 255, g = px[i + 1] / 255, b = px[i + 2] / 255
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b), df = mx - mn
        if (df / mx < 0.18 || mx < 0.18) continue
        let h = 0
        if (mx === r) h = ((g - b) / df + 6) % 6
        else if (mx === g) h = (b - r) / df + 2
        else h = (r - g) / df + 4
        h *= 60
        if (h >= 195 && h < 260) buckets.blue++
        else if (h >= 90 && h < 170) buckets.green++
        else if (h >= 330 || h < 60) buckets.warm++
        else buckets.other++
      }
      const pct = (n) => (buckets.opaque ? ((n / buckets.opaque) * 100).toFixed(2) + '%' : '0%')
      return { blue: pct(buckets.blue), green: pct(buckets.green), warm: pct(buckets.warm), other: pct(buckets.other) }
    })

  // 切 Hiyori → 海盐蓝
  await page.evaluate(() => {
    ;[...document.querySelectorAll('.style-chip')].find((b) => b.textContent.includes('Hiyori'))?.click()
  })
  await new Promise((r) => setTimeout(r, 8000))
  outfitLogs.length = 0
  console.log('PROD HIYORI base:', JSON.stringify(await countHues()))
  await page.evaluate(() => {
    ;[...document.querySelectorAll('.style-chip')].find((b) => b.textContent.includes('海盐蓝'))?.click()
  })
  await new Promise((r) => setTimeout(r, 10000))
  console.log('PROD HIYORI seablue:', JSON.stringify(await countHues()))
  console.log('--- logs ---')
  outfitLogs.forEach((l) => console.log('  ' + l))

  await browser.close()
})().catch((e) => { console.error('PROBE FAIL:', e); process.exit(1) })
