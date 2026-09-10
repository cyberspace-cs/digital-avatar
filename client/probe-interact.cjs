/* 探针：A→B feed 互动链路嗅探
 * 在 A/B 两页 evaluateOnNewDocument 包一层 XHR，记录所有含 "interaction" 的
 * socket.io 轮询帧（POST=发送方向，GET=接收方向），判定 emit 是否出浏览器、推送是否到 B。
 */
const puppeteer = require('puppeteer-core')

const SNIFF = () => {
  window.__frames = []
  const OldOpen = XMLHttpRequest.prototype.open
  const OldSend = XMLHttpRequest.prototype.send
  XMLHttpRequest.prototype.open = function (m, u, ...rest) {
    this.__url = String(u)
    this.__method = m
    return OldOpen.call(this, m, u, ...rest)
  }
  XMLHttpRequest.prototype.send = function (body) {
    const xhr = this
    if (String(xhr.__url).includes('socket.io')) {
      if (xhr.__method === 'POST' && body && String(body).includes('interaction')) {
        window.__frames.push('OUT ' + String(body).slice(0, 400))
      }
      if (xhr.__method === 'GET') {
        xhr.addEventListener('load', function () {
          try {
            const t = xhr.responseText
            if (t && t.includes('interaction')) window.__frames.push('IN ' + t.slice(0, 400))
          } catch (_e) { /* ignore */ }
        })
      }
    }
    return OldSend.call(this, body)
  }
}

;(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: 'new',
    protocolTimeout: 300000,
    args: ['--window-size=420,860'],
  })
  const mkPage = async () => {
    const ctx = await browser.createBrowserContext()
    const page = await ctx.newPage()
    await page.setViewport({ width: 412, height: 850 })
    await page.evaluateOnNewDocument(SNIFF)
    page.on('pageerror', (e) => console.log('PAGEERROR:', String(e).split('\n')[0]))
    await page.goto('http://localhost:4173/digital-avatar/', { waitUntil: 'networkidle2', timeout: 30000 })
    return page
  }
  const waitModel = async (page) => {
    for (let i = 0; i < 60; i++) {
      const ok = await page.evaluate(() => {
        let u = null
        try { u = JSON.parse(localStorage.getItem('da_me')) } catch (_e) { return false }
        return !!(u && window.__pixi && window.__pixi.meS && window.__pixi.meS.model)
      }).catch(() => false)
      if (ok) return true
      await new Promise((r) => setTimeout(r, 500))
    }
    return false
  }
  const onboard = async (page, name) => {
    await page.evaluate(() => localStorage.clear())
    await page.reload({ waitUntil: 'networkidle2' })
    await new Promise((r) => setTimeout(r, 600))
    await page.type('.onboard input', name)
    await page.click('.onboard button')
    if (!(await waitModel(page))) throw new Error('model not loaded ' + name)
    return page.evaluate(() => JSON.parse(localStorage.getItem('da_me')))
  }

  const pa = await mkPage()
  const A = await onboard(pa, '探针A')
  const pb = await mkPage()
  const B = await onboard(pb, '探针B')

  await pa.evaluate(async (uid) => {
    const r = await (await fetch('/digital-avatar/api/invite', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: uid }),
    })).json()
    return r.code
  }, A.id).then((code) =>
    pb.evaluate(async (u, c) => {
      await fetch(`/digital-avatar/api/invite/${c}/accept`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: u.id }),
      })
    }, B, code),
  )
  await Promise.all([pa.reload({ waitUntil: 'networkidle2' }), pb.reload({ waitUntil: 'networkidle2' })])
  await waitModel(pa)
  await waitModel(pb)
  await new Promise((r) => setTimeout(r, 1500))

  // A 点喂食
  await pa.evaluate(() => document.querySelectorAll('.dock-btn')[0]?.click())

  // 8 秒内每 300ms 记录 B 端气泡
  const bubbles = []
  for (let i = 0; i < 27; i++) {
    const b = await pb.evaluate(() => document.querySelector('.bubble')?.textContent ?? null).catch(() => 'EVAL_ERR')
    if (b) bubbles.push(b)
    await new Promise((r) => setTimeout(r, 300))
  }

  const framesA = await pa.evaluate(() => window.__frames)
  const framesB = await pb.evaluate(() => window.__frames)
  console.log('=== A 帧中的 interaction ===')
  framesA.forEach((f) => console.log(' ', f.slice(0, 200)))
  console.log('=== B 帧中的 interaction ===')
  framesB.forEach((f) => console.log(' ', f.slice(0, 200)))
  console.log('=== B 端气泡记录 ===', JSON.stringify(bubbles))
  console.log('A.id=', A.id, 'B.id=', B.id)

  await browser.close()
})().catch((e) => { console.error('PROBE_FAIL', e); process.exit(1) })
