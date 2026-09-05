/* 生产加载诊断：看 console 错误与模型加载耗时 */
const puppeteer = require('puppeteer-core')

;(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: 'new',
    protocolTimeout: 300000,
    args: ['--window-size=420,860'],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 412, height: 850, deviceScaleFactor: 2 })
  page.on('console', (m) => console.log('[console:' + m.type() + ']', m.text().slice(0, 200)))
  page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)))
  page.on('requestfailed', (r) => console.log('[reqfail]', r.url().slice(-80), r.failure()?.errorText))
  const t0 = Date.now()
  await page.goto('https://taoxie.vip/digital-avatar/', { waitUntil: 'networkidle2', timeout: 60000 })
  console.log('goto done in', Date.now() - t0, 'ms')
  await page.evaluate(() => localStorage.clear())
  await page.reload({ waitUntil: 'networkidle2', timeout: 60000 })
  await page.type('.onboard input', '诊断用户')
  await page.click('.onboard button')
  for (let i = 0; i < 120; i++) {
    const st = await page.evaluate(() => ({
      me: !!localStorage.getItem('da_me'),
      pixi: !!window.__pixi,
      model: !!(window.__pixi && window.__pixi.meS && window.__pixi.meS.model),
    }))
    if (st.model) { console.log('MODEL LOADED at', Date.now() - t0, 'ms'); break }
    if (i % 10 === 9) console.log('waiting...', JSON.stringify(st), Date.now() - t0, 'ms')
    await new Promise((r) => setTimeout(r, 500))
  }
  await browser.close()
})().catch((e) => { console.error('FATAL', e); process.exit(1) })
