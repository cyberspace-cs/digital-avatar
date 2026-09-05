/* V1.6.0 验证：情侣衣橱（一键情侣装 / 双端同步 / 徽章 / 成套款 / 同性别双子装 / 解除 / 离线愈合 / 服务端校验 / 纹理探针）
 *
 * 前置：npm run build 后 vite preview(4173) + server(8090) 在跑
 * 用法：node verify-v160.cjs
 */
const puppeteer = require('puppeteer-core')
const path = require('path')

const SHOTS = path.join(__dirname, 'shots')
const ORIGIN = 'http://localhost:4173/digital-avatar/'
const results = []
const record = (id, ok, detail) => {
  results.push({ id, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id}: ${detail}`)
}

;(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: 'new',
    protocolTimeout: 300000,
    args: ['--window-size=420,860', '--force-device-scale-factor=2'],
  })
  const errors = []
  const mkCtx = async () => {
    // 教训（V1.4.3）：同 context 的页面共享 localStorage —— 这里 A/B 必须各自独立 context；
    // 而 T8 离线愈合反过来利用同一 context 新开页面继承 localStorage
    const ctx = await browser.createBrowserContext()
    return ctx
  }
  const mkPage = async (ctx) => {
    const page = await ctx.newPage()
    await page.setViewport({ width: 412, height: 850, deviceScaleFactor: 2 })
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)) })
    page.on('pageerror', (e) => {
      const stack = String((e && e.stack) || e)
      errors.push('PAGEERROR: ' + stack.split('\n')[0].slice(0, 160))
      console.log(`PAGEERROR[${stack.split('\n').slice(0, 6).join(' | ')}]`)
    })
    await page.goto(ORIGIN, { waitUntil: 'networkidle2', timeout: 30000 })
    await new Promise((r) => setTimeout(r, 800))
    return page
  }
  const waitModel = async (page, who = 'meS', timeout = 40) => {
    for (let i = 0; i < timeout * 2; i++) {
      const ok = await page.evaluate((w) => {
        let u = null
        try { u = JSON.parse(localStorage.getItem('da_me')) } catch (_e) { return false }
        return !!(u && window.__pixi && window.__pixi[w] && window.__pixi[w].model)
      }, who)
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
  const clickChip = async (page, text, scope = '') => {
    await page.evaluate((t, sc) => {
      ;[...document.querySelectorAll(`${sc} .style-chip`)].find((b) => b.textContent.includes(t))?.click()
    }, text, scope)
  }
  // 情侣行专用点击：款式行里 Chitose/Haru 也有同名变体芯片（如「海雾格纹」），不能误命中
  const clickCouple = async (page, text) => clickChip(page, text, '.couple-row')
  // 轮询直到条件成立（UI/socket 异步链路统一等待器）
  const until = async (page, fn, timeoutS = 15, who = 'meS') => {
    for (let i = 0; i < timeoutS * 2; i++) {
      if (await page.evaluate(fn, who)) return true
      await new Promise((r) => setTimeout(r, 500))
    }
    return false
  }
  const waitFor = async (page, fnStr, timeoutS = 15) => {
    for (let i = 0; i < timeoutS * 2; i++) {
      if (await page.evaluate(fnStr)) return true
      await new Promise((r) => setTimeout(r, 500))
    }
    return false
  }
  const lookOf = (page) =>
    page.evaluate(() => ({
      style: localStorage.getItem('da_style'),
      outfit: localStorage.getItem('da_outfit'),
    }))
  const serverLook = (page, uid) =>
    page.evaluate(async (u) => {
      const r = await (await fetch('/digital-avatar/api/state/' + u)).json()
      return { style: r.style ?? 'default', outfit: r.outfit ?? 'base' }
    }, uid)

  // ============ 准备：A(Chitose 男) + B(Haru 女)，绑定 ============
  const ctxA = await mkCtx()
  const pa = await mkPage(ctxA)
  const A = await onboard(pa, '测试阿A')
  await openWardrobe(pa)
  await clickChip(pa, 'Chitose')
  await new Promise((r) => setTimeout(r, 5000))
  if (!(await waitModel(pa))) throw new Error('A chitose model failed')

  const ctxB = await mkCtx()
  let pb = await mkPage(ctxB)
  const B = await onboard(pb, '测试阿B')
  await openWardrobe(pb)
  await clickChip(pb, 'Haru')
  await new Promise((r) => setTimeout(r, 5000))
  if (!(await waitModel(pb))) throw new Error('B haru model failed')

  // 绑定：A 生成邀请码 → B 接受 → 双方 reload 让 getPartner 拉起
  const code = await pa.evaluate(async (uid) =>
    (await (await fetch('/digital-avatar/api/invite', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: uid }),
    })).json()).code, A.id)
  const bondRes = await pb.evaluate(async (c, uid) =>
    (await (await fetch(`/digital-avatar/api/invite/${c}/accept`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: uid }),
    })).json()), code, B.id)
  console.log('BOND:', JSON.stringify({ code, partner: bondRes.partner?.id }))
  await Promise.all([pa.reload({ waitUntil: 'networkidle2' }), pb.reload({ waitUntil: 'networkidle2' })])
  if (!(await waitModel(pa)) || !(await waitModel(pb))) throw new Error('reload models failed')
  await openWardrobe(pa)
  await openWardrobe(pb)

  // ============ T1: 无 partner 用户不显示情侣装行 ============
  const ctxD = await mkCtx()
  const pd = await mkPage(ctxD)
  await onboard(pd, '测试阿D')
  await openWardrobe(pd)
  const t1 = await pd.evaluate(() => !!document.querySelector('.couple-row'))
  record('T1_NO_PARTNER_NO_ROW', !t1, `couple-row hidden=${!t1}`)

  // ============ T2: 绑定后情侣装行显示（7 主题 + 解除） ============
  const t2a = await pa.evaluate(() => document.querySelectorAll('.couple-row .couple-chip').length)
  const t2b = await pb.evaluate(() => document.querySelectorAll('.couple-row .couple-chip').length)
  record('T2_COUPLE_ROW_SHOWN', t2a === 8 && t2b === 8, `A chips=${t2a} B chips=${t2b} (期望 8=7主题+解除)`)

  // ============ T3: A 点「海雾情侣」→ A=navy / B 免操作=ocean（couple_applied 推送） ============
  await clickCouple(pa, '海雾情侣')
  const t3a = await until(pa, () => localStorage.getItem('da_style') === 'navy')
  const t3b = await until(pb, () => localStorage.getItem('da_style') === 'ocean', 15)
  record('T3_SEAFOG_SYNC', t3a && t3b, `A.style=${(await lookOf(pa)).style}(期望navy) B.style=${(await lookOf(pb)).style}(期望ocean,接收端免操作)`)

  // ============ T4: 徽章点亮 + 服务端落库 ============
  const badgeA = await pa.evaluate(() => document.querySelector('.couple-badge')?.textContent ?? null)
  const badgeB = await pb.evaluate(() => document.querySelector('.couple-badge')?.textContent ?? null)
  const svA = await serverLook(pa, A.id)
  const svB = await serverLook(pb, B.id)
  record('T4_BADGE_AND_DB',
    !!badgeA && badgeA.includes('海雾') && !!badgeB && badgeB.includes('海雾')
    && svA.style === 'navy' && svB.style === 'ocean',
    `A.badge=${JSON.stringify(badgeA)} B.badge=${JSON.stringify(badgeB)} server A=${JSON.stringify(svA)} B=${JSON.stringify(svB)}`)
  await pa.screenshot({ path: path.join(SHOTS, 'v160-a-seafog.png') })
  await pb.screenshot({ path: path.join(SHOTS, 'v160-b-seafog.png') })

  // ============ T5: 成套款「海雾格纹」→ 双端 variant + 变体纹理真实加载 ============
  await clickCouple(pa, '海雾格纹')
  const t5a = await until(pa, () => localStorage.getItem('da_outfit') === 'knit_sea')
  const t5b = await until(pb, () => localStorage.getItem('da_outfit') === 'sailor_sea')
  // 资源探针：变体纹理必须真的被 fetch 进模型（不是只改了 state）
  const texA = await until(pa, () =>
    performance.getEntriesByType('resource').some((e) => e.name.includes('outfits/knit_sea/')))
  const texB = await until(pb, () =>
    performance.getEntriesByType('resource').some((e) => e.name.includes('outfits/sailor_sea/')))
  const badge5 = await pa.evaluate(() => document.querySelector('.couple-badge')?.textContent ?? null)
  record('T5_COUPLE_SET', t5a && t5b && texA && texB && !!badge5 && badge5.includes('格纹'),
    `A.outfit=knit_sea:${t5a} B.outfit=sailor_sea:${t5b} 纹理加载 A:${texA} B:${texB} badge=${JSON.stringify(badge5)}`)
  await pa.screenshot({ path: path.join(SHOTS, 'v160-a-knitsea.png') })
  await pb.screenshot({ path: path.join(SHOTS, 'v160-b-sailorsea.png') })

  // ============ T6: 同性别组合（B 切 Natori 男模）→ 双子装都取 m 槽 ============
  await openWardrobe(pb)
  await clickChip(pb, 'Natori')
  await new Promise((r) => setTimeout(r, 6000))
  if (!(await waitModel(pb))) throw new Error('B natori model failed')
  // 换形象后款式回落 base（服务端也要回落）
  await until(pb, () => localStorage.getItem('da_outfit') === 'base')
  await clickCouple(pa, '经典黑白')
  const t6a = await until(pa, () => localStorage.getItem('da_style') === 'mono')
  const t6b = await until(pb, () => localStorage.getItem('da_style') === 'mono')
  const svB6 = await serverLook(pb, B.id)
  record('T6_SAME_GENDER_M_SLOT', t6a && t6b && svB6.style === 'mono' && svB6.outfit === 'base',
    `A.style=mono:${t6a} B.style=mono:${t6b} B.server=${JSON.stringify(svB6)}(男模取 m 槽)`)

  // ============ T7: 解除情侣装 → 双端回原生 + 徽章熄灭 ============
  await clickCouple(pa, '解除')
  const t7a = await until(pa, () => localStorage.getItem('da_style') === 'default' && localStorage.getItem('da_outfit') === 'base')
  const t7b = await until(pb, () => localStorage.getItem('da_style') === 'default' && localStorage.getItem('da_outfit') === 'base')
  await new Promise((r) => setTimeout(r, 1500))
  const badge7 = await pa.evaluate(() => document.querySelector('.couple-badge')?.textContent ?? null)
  record('T7_RESET', t7a && t7b && !badge7, `A=${JSON.stringify(await lookOf(pa))} B=${JSON.stringify(await lookOf(pb))} badge=${JSON.stringify(badge7)}(期望null)`)

  // ============ T8: 离线愈合 —— B 关页后 A 给 TA 换装，B 重开自动对齐 ============
  await pb.close() // B 离线（context localStorage 保留）
  await clickCouple(pa, '暮樱情侣')
  await until(pa, () => localStorage.getItem('da_style') === 'charcoal', 15) // 等 A 端结算完成
  const svB8 = await serverLook(pa, B.id)
  const pB2 = await mkPage(ctxB) // 同 context 新开页 = 同一身份的"重新上线"
  pb = pB2 // 后续测试改用新页面（旧 frame 已 detach）
  await pB2.reload({ waitUntil: 'networkidle2' })
  if (!(await waitModel(pB2))) throw new Error('T8 B model failed')
  const t8b = await until(pB2, () => localStorage.getItem('da_style') === 'charcoal', 15)
  const badge8 = await pB2.evaluate(() => document.querySelector('.couple-badge')?.textContent ?? null)
  record('T8_OFFLINE_HEAL', t8b && svB8.style === 'charcoal' && !!badge8 && badge8.includes('暮樱'),
    `B离线被换装 server=${JSON.stringify(svB8)} 重开后本地style=${(await lookOf(pB2)).style} badge=${JSON.stringify(badge8)}`)
  await openWardrobe(pB2)
  await pB2.screenshot({ path: path.join(SHOTS, 'v160-b-duskcherry-healed.png') })

  // ============ T9: 服务端校验（无 bond 400 / 非法主题 400 / 无 partner 也可单端结算拒绝） ============
  const t9a = await pd.evaluate(async (uid) => {
    const r = await fetch('/digital-avatar/api/couple-outfit', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: uid, themeId: 'seafog' }),
    })
    return { status: r.status, body: await r.json() }
  }, (await pd.evaluate(() => JSON.parse(localStorage.getItem('da_me')))).id)
  const t9b = await pa.evaluate(async (uid) => {
    const r = await fetch('/digital-avatar/api/couple-outfit', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: uid, themeId: 'no_such_theme' }),
    })
    return { status: r.status }
  }, A.id)
  record('T9_SERVER_GUARD', t9a.status === 400 && t9b.status === 400,
    `no_bond=${t9a.status}/${JSON.stringify(t9a.body)} bad_theme=${t9b.status}`)

  // ============ T10: 纹理资产探针 —— 情侣款纹理有差异但非整图重涂（服装区改、脸发区不动） ============
  const t10a = await pa.evaluate(async () => {
    const load = (src) => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src })
    const [ia, ib] = await Promise.all([
      load('/digital-avatar/models/chitose/chitose.2048/texture_00.png'),
      load('/digital-avatar/models/chitose/outfits/knit_sea/texture_00.png'),
    ])
    const c = document.createElement('canvas'); c.width = ia.width; c.height = ia.height
    const g = c.getContext('2d'); g.drawImage(ia, 0, 0)
    const d1 = g.getImageData(0, 0, ia.width, ia.height).data
    const c2 = document.createElement('canvas'); c2.width = ib.width; c2.height = ib.height
    const g2 = c2.getContext('2d'); g2.drawImage(ib, 0, 0)
    const d2 = g2.getImageData(0, 0, ib.width, ib.height).data
    let diff = 0; const total = d1.length / 4
    for (let i = 0; i < d1.length; i += 4) {
      if (Math.abs(d1[i] - d2[i]) + Math.abs(d1[i + 1] - d2[i + 1]) + Math.abs(d1[i + 2] - d2[i + 2]) > 30) diff++
    }
    return { diff, total, ratio: diff / total }
  })
  // 期望：服装区改动明显（>8%）但脸/发/皮肤占大头不变（<35%）
  const t10b = await pa.evaluate(async () => {
    const load = (src) => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src })
    const [ia, ib] = await Promise.all([
      load('/digital-avatar/models/haru/Haru.2048/texture_01.png'),
      load('/digital-avatar/models/haru/outfits/sailor_sea/texture_01.png'),
    ])
    const c = document.createElement('canvas'); c.width = ia.width; c.height = ia.height
    const g = c.getContext('2d'); g.drawImage(ia, 0, 0)
    const d1 = g.getImageData(0, 0, ia.width, ia.height).data
    const c2 = document.createElement('canvas'); c2.width = ib.width; c2.height = ib.height
    const g2 = c2.getContext('2d'); g2.drawImage(ib, 0, 0)
    const d2 = g2.getImageData(0, 0, ib.width, ib.height).data
    let diff = 0; const total = d1.length / 4
    for (let i = 0; i < d1.length; i += 4) {
      if (Math.abs(d1[i] - d2[i]) + Math.abs(d1[i + 1] - d2[i + 1]) + Math.abs(d1[i + 2] - d2[i + 2]) > 30) diff++
    }
    return { diff, total, ratio: diff / total }
  })
  // Haru texture_01 = 服装+发团混合图（脸/皮肤在 texture_00 不参与），服装占比高，上限放宽到 55%
  const t10ok = (x) => x && x.ratio > 0.08 && x.ratio < 0.55
  record('T10_TEXTURE_PROBE', t10ok(t10a) && t10ok(t10b),
    `chitose diff=${t10a.diff}/${t10a.total} (${(t10a.ratio * 100).toFixed(1)}%) haru diff=${t10b.diff}/${t10b.total} (${(t10b.ratio * 100).toFixed(1)}%) 期望 8%~55%`)

  // ============ T11: 快速连点两个主题 → 最终意图收敛（race condition 防护） ============
  // 调研依据：实时应用需覆盖 race condition / 乱序消息（DZone Playwright real-time testing、
  // thegreenreport WebSocket Testing Essentials 的 state-dependent interactions）
  await clickCouple(pa, '旷野情侣')
  await new Promise((r) => setTimeout(r, 120))
  await clickCouple(pa, '暗夜情侣')
  await until(pa, () => localStorage.getItem('da_style') === 'navy', 15)
  await until(pb, () => localStorage.getItem('da_style') === 'navy', 15)
  const t11a = await lookOf(pa)
  const t11b = await lookOf(pb)
  const t11sA = await serverLook(pa, A.id)
  const t11sB = await serverLook(pb, B.id)
  record('T11_RAPID_CLICK_CONVERGE',
    t11a.style === 'navy' && t11b.style === 'navy' && t11sA.style === 'navy' && t11sB.style === 'navy',
    `连点 旷野→暗夜 后 A=${t11a.style} B=${t11b.style} serverA=${t11sA.style} serverB=${t11sB.style}（四方应一致=navy）`)

  // ============ T12: 双端同时点不同主题 → 并发结算后三方收敛（last-write-wins 一致） ============
  // 调研依据：多用户并发是实时应用 E2E 必测面（DZone: multi-user simulation）
  await openWardrobe(pb)
  await Promise.all([
    clickCouple(pa, '旷野情侣'),
    clickCouple(pb, '暗夜情侣'),
  ])
  await new Promise((r) => setTimeout(r, 6000)) // 两次结算 + 双端广播完成
  const t12a = await lookOf(pa)
  const t12b = await lookOf(pb)
  const t12sA = await serverLook(pa, A.id)
  const t12sB = await serverLook(pb, B.id)
  const t12all = [t12a.style, t12b.style, t12sA.style, t12sB.style]
  record('T12_CONCURRENT_SETTLE', new Set(t12all).size === 1,
    `并发 旷野×暗夜 后四方 style=${JSON.stringify(t12all)}（并发后应收敛为同一值）`)

  // ============ T13: 同主题幂等重放 → 状态不变 + 零多余模型重载 ============
  // 调研依据：幂等与隔离是 E2E 可靠性基础（testdevlab "Idempotency and test isolation"）
  const resCountBefore = await pa.evaluate(() =>
    performance.getEntriesByType('resource').filter((e) => e.name.includes('/outfits/')).length)
  await clickCouple(pa, '暗夜情侣')
  await new Promise((r) => setTimeout(r, 3000))
  const t13sFirst = await serverLook(pa, A.id)
  await clickCouple(pa, '暗夜情侣')
  await new Promise((r) => setTimeout(r, 4000))
  const resCountAfter = await pa.evaluate(() =>
    performance.getEntriesByType('resource').filter((e) => e.name.includes('/outfits/')).length)
  const t13sA = await serverLook(pa, A.id)
  record('T13_IDEMPOTENT_REPLAY',
    resCountAfter === resCountBefore && t13sFirst.style === t13sA.style && t13sFirst.outfit === t13sA.outfit,
    `重复点击前后 /outfits/ 资源请求数 ${resCountBefore}→${resCountAfter}（应相等=零重载），server ${JSON.stringify(t13sFirst)}→${JSON.stringify(t13sA)}（应不变）`)

  // ============ 汇总 ============
  const failed = results.filter((r) => !r.ok)
  console.log('\n==== SUMMARY ====')
  for (const r of results) console.log(`${r.ok ? '✅' : '❌'} ${r.id}`)
  console.log(`CONSOLE_ERRORS(${errors.length}):`, JSON.stringify(errors.slice(0, 8)))
  console.log(`TOTAL: ${results.length - failed.length}/${results.length} passed`)
  await browser.close()
  if (failed.length) process.exit(1)
})().catch((e) => { console.error('FATAL', e); process.exit(1) })
