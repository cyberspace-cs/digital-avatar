/* V1.5.0 补充：Chitose 模型本体 换色前后对比截图（陪伴 tab） */
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
  const ctx = await browser.createBrowserContext()
  const page = await ctx.newPage()
  await page.setViewport({ width: 412, height: 850, deviceScaleFactor: 2 })
  await page.goto('http://localhost:4173/digital-avatar/', { waitUntil: 'networkidle2', timeout: 30000 })
  await page.evaluate(() => localStorage.clear())
  await page.reload({ waitUntil: 'networkidle2' })
  await new Promise((r) => setTimeout(r, 800))
  await page.type('.onboard input', '截图侠')
  await page.click('.onboard button')
  for (let i = 0; i < 40; i++) {
    if (await page.evaluate(() => {
      try { return !!(JSON.parse(localStorage.getItem('da_me')) && window.__pixi?.meS?.model) } catch (_e) { return false }
    })) break
    await new Promise((r) => setTimeout(r, 500))
  }
  const av0 = await page.evaluate(() => JSON.parse(localStorage.getItem('da_me'))?.avatar)
  console.log('initial avatar =', av0)
  // 确保形象是 Chitose
  await page.evaluate(() => document.querySelectorAll('.tabbar .tab')[3]?.click())
  await new Promise((r) => setTimeout(r, 400))
  const needSwitch = await page.evaluate(() => JSON.parse(localStorage.getItem('da_me')).avatar !== 'chitose')
  console.log('needSwitch =', needSwitch)
  if (needSwitch) {
    await page.evaluate(() => {
      ;[...document.querySelectorAll('.style-chip')].find((b) => b.textContent.includes('Chitose'))?.click()
    })
    await new Promise((r) => setTimeout(r, 5000))
  }
  console.log('after switch avatar =', await page.evaluate(() => JSON.parse(localStorage.getItem('da_me'))?.avatar))
  // 回陪伴 tab 拍原生
  await page.evaluate(() => document.querySelectorAll('.tabbar .tab')[0]?.click())
  await new Promise((r) => setTimeout(r, 1200))
  await page.screenshot({ path: path.join(SHOTS, 'v150-model-default.png') })
  // 藏青
  await page.evaluate(() => document.querySelectorAll('.tabbar .tab')[3]?.click())
  await new Promise((r) => setTimeout(r, 400))
  await page.evaluate(() => {
    ;[...document.querySelectorAll('.style-chip')].find((b) => b.textContent.includes('藏青'))?.click()
  })
  await new Promise((r) => setTimeout(r, 4000))
  await page.evaluate(() => document.querySelectorAll('.tabbar .tab')[0]?.click())
  await new Promise((r) => setTimeout(r, 1200))
  await page.screenshot({ path: path.join(SHOTS, 'v150-model-navy.png') })
  // 军绿
  await page.evaluate(() => document.querySelectorAll('.tabbar .tab')[3]?.click())
  await new Promise((r) => setTimeout(r, 400))
  await page.evaluate(() => {
    ;[...document.querySelectorAll('.style-chip')].find((b) => b.textContent.includes('军绿'))?.click()
  })
  await new Promise((r) => setTimeout(r, 4000))
  await page.evaluate(() => document.querySelectorAll('.tabbar .tab')[0]?.click())
  await new Promise((r) => setTimeout(r, 1200))
  await page.screenshot({ path: path.join(SHOTS, 'v150-model-olive.png') })
  await browser.close()
  console.log('DONE')
})().catch((e) => { console.error('FATAL', e); process.exit(1) })
