/* V1.6.1 验证：邀请链接分享闭环（发给 TA → TA 打开接受 → 绑定 → 状态/穿搭同步）+ 桌宠模式升级
 *
 * 前置：npm run build 后 vite preview(4173) + server(8090) 在跑
 * 用法：node verify-invite.cjs
 */
const puppeteer = require('puppeteer-core')
const path = require('path')

const SHOTS = path.join(__dirname, 'shots')
const ORIGIN = process.env.ORIGIN ?? 'http://localhost:4173/digital-avatar/'
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
  const mkCtx = async () => browser.createBrowserContext()
  const mkPage = async (ctx) => {
    const page = await ctx.newPage()
    await page.setViewport({ width: 412, height: 850, deviceScaleFactor: 2 })
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)) })
    page.on('pageerror', (e) => {
      const stack = String((e && e.stack) || e)
      errors.push('PAGEERROR: ' + stack.split('\n')[0].slice(0, 160))
      console.log(`PAGEERROR[${stack.split('\n').slice(0, 4).join(' | ')}]`)
    })
    await page.goto(ORIGIN, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await new Promise((r) => setTimeout(r, 2000))
    return page
  }
  // 生产上邀请接受成功后 1.2s 会 location.href 跳转清参数，会摧毁执行中的 evaluate 上下文
  // （本地加载快、轮询先返回故不复现）→ 所有 evaluate 轮询必须容错导航
  const safeEval = async (page, fn, ...args) => {
    for (let i = 0; i < 20; i++) {
      try { return await page.evaluate(fn, ...args) } catch (_e) { /* navigation destroyed */ }
      await new Promise((r) => setTimeout(r, 500))
    }
    return undefined
  }
  const waitModel = async (page, who = 'meS', timeout = 120) => {
    for (let i = 0; i < timeout * 2; i++) {
      const ok = await safeEval(page, (w) => {
        let u = null
        try { u = JSON.parse(localStorage.getItem('da_me')) } catch (_e) { return false }
        return !!(u && window.__pixi && window.__pixi[w] && window.__pixi[w].model)
      }, who).catch(() => false)
      if (ok) return true
      await new Promise((r) => setTimeout(r, 500))
    }
    return false
  }
  const onboard = async (page, name) => {
    await page.evaluate(() => localStorage.clear())
    await page.reload({ waitUntil: 'domcontentloaded' })
    await new Promise((r) => setTimeout(r, 800))
    await page.type('.onboard input', name)
    await page.click('.onboard button')
    if (!(await waitModel(page))) throw new Error('model not loaded for ' + name)
    return (await safeEval(page, () => JSON.parse(localStorage.getItem('da_me')))) ?? {}
  }
  const until = async (page, fn, timeoutS = 15) => {
    for (let i = 0; i < timeoutS * 2; i++) {
      try { if (await page.evaluate(fn)) return true } catch (_e) { /* 导航中 */ }
      await new Promise((r) => setTimeout(r, 500))
    }
    return false
  }
  const toastOf = async (page) =>
    (await safeEval(page, () => document.querySelector('.toast')?.textContent ?? '')) ?? ''
  const bodyHas = (page, text) => page.evaluate((t) => document.body.textContent.includes(t), text)

  // ============ T1/T2: A 生成邀请链接（格式 + 复制） ============
  const ctxA = await mkCtx()
  const pa = await mkPage(ctxA)
  const A = await onboard(pa, '邀请主A')
  await pa.evaluate(() => {
    ;[...document.querySelectorAll('button')].find((b) => b.textContent.includes('把我的分身送给'))?.click()
  })
  const linkOk = await until(pa, () => !!document.querySelector('.link-text')?.textContent?.includes('?invite='))
  const link = (await pa.evaluate(() => document.querySelector('.link-text')?.textContent ?? '')).trim()
  record('T1_LINK_FORMAT', linkOk && link.startsWith(ORIGIN) && /[?&]invite=[A-Za-z0-9_-]+$/.test(link),
    `link=${link} (期望 ${ORIGIN}?invite=code)`)

  // T2 复制按钮：点击后 toast 提示（headless 剪贴板读权限不稳定，以 toast 反馈为准 + 链接文本 T1 已证）
  await pa.evaluate(() => {
    ;[...document.querySelectorAll('button')].find((b) => b.textContent.includes('复制链接'))?.click()
  })
  const copyToast = await until(pa, () => (document.querySelector('.toast')?.textContent ?? '').includes('复制'), 8)
  record('T2_COPY_FEEDBACK', copyToast, `复制反馈=${JSON.stringify(await toastOf(pa))}`)

  // ============ T3: 全新用户 B 打开链接 → onboard → 自动接受 → 双端互见 ============
  const ctxB = await mkCtx()
  const pb = await mkPage(ctxB)
  await pb.goto(link, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await new Promise((r) => setTimeout(r, 1500))
  const B = await onboard(pb, '受邀阿B')
  // onboard 完成后自动 accept：toast「收到 邀请主A 送你的数字分身！」→ 1.2s 后跳转清洗 URL
  const accepted = await until(pb, () => !location.search.includes('invite='), 20)
  const bSeesA = await until(pb, () => document.body.textContent.includes('邀请主A'), 15)
  record('T3_NEWCOMER_ACCEPT', accepted && bSeesA,
    `B打开链接onboard后: url清洗=${accepted} B端见到A=${bSeesA} toast=${JSON.stringify(await toastOf(pb))}`)

  // T3B: A 端 reload 后也见到 B
  await pa.reload({ waitUntil: 'domcontentloaded' })
  await waitModel(pa)
  const aSeesB = await until(pa, () => document.body.textContent.includes('受邀阿B'), 15)
  record('T3B_A_SEES_B', aSeesB, `A端见到B=${aSeesB}`)

  // ============ T4: 状态同步 —— A 设状态「开心」→ B 端看到 ============
  await pa.evaluate(() => document.querySelectorAll('.tabbar .tab')[3]?.click())
  await new Promise((r) => setTimeout(r, 500))
  await pa.evaluate(() => {
    ;[...document.querySelectorAll('button')].find((b) => b.textContent.includes('设置状态'))?.click()
  })
  await new Promise((r) => setTimeout(r, 600))
  await pa.evaluate(() => {
    ;[...document.querySelectorAll('.modal .mood-grid .btn')].find((b) => b.textContent.includes('开心'))?.click()
  })
  await new Promise((r) => setTimeout(r, 1500))
  await pb.evaluate(() => document.querySelectorAll('.tabbar .tab')[0]?.click())
  const t4 = await until(pb, () => document.body.textContent.includes('开心'), 15)
  record('T4_MOOD_SYNC', t4, `A设开心 → B端可见=${t4}`)

  // ============ T5: 穿搭同步 —— B 换色板（色板芯片带 👗 emoji，与形象性别无关）→ A 端对方分身同步 ============
  await pb.evaluate(() => document.querySelectorAll('.tabbar .tab')[3]?.click())
  await new Promise((r) => setTimeout(r, 500))
  await pb.evaluate(() => {
    ;[...document.querySelectorAll('.style-chip')]
      .filter((b) => b.querySelector('.style-emoji')?.textContent === '👗')[0]?.click() // 原生是🌱不被过滤，[0]=第一个色板
  })
  const bStyled = await until(pb, () => localStorage.getItem('da_style') !== 'default', 15)
  const bStyle = await pb.evaluate(() => localStorage.getItem('da_style'))
  let aPartnerStyled = false
  for (let i = 0; i < 30; i++) {
    const s = await pa.evaluate(() => window.__pixi?.partnerS?.style ?? null)
    if (s && s === bStyle) { aPartnerStyled = true; break }
    await new Promise((r) => setTimeout(r, 500))
  }
  record('T5_OUTFIT_SYNC', bStyled && aPartnerStyled,
    `B换海盐蓝(${bStyle}): B.local=${bStyle} A.partnerS.style=${await pa.evaluate(() => window.__pixi?.partnerS?.style)}`)

  // ============ T6: 无效邀请码 ============
  const ctxD = await mkCtx()
  const pd = await mkPage(ctxD)
  await pd.goto(ORIGIN.split('?')[0] + '?invite=bad-code-xxx', { waitUntil: 'domcontentloaded' })
  await new Promise((r) => setTimeout(r, 1500))
  await pd.evaluate(() => localStorage.clear())
  await pd.reload({ waitUntil: 'domcontentloaded' })
  await new Promise((r) => setTimeout(r, 800))
  // V1.6.2：toast 可能一闪而过（生产模型加载慢，accept 在 waitModel 期间就完成），
  // 轮询会漏捕获 → MutationObserver 全程记录 toast 历史
  await pd.evaluate(() => {
    window.__toasts = []
    new MutationObserver(() => {
      const t = document.querySelector('.toast')?.textContent
      if (t && window.__toasts[window.__toasts.length - 1] !== t) window.__toasts.push(t)
    }).observe(document.body, { childList: true, subtree: true, characterData: true })
  })
  await pd.type('.onboard input', '无效码D')
  await pd.click('.onboard button')
  const t6 = await until(pd, () => (window.__toasts || []).length > 0, 12)
  const toasts = (await safeEval(pd, () => window.__toasts)) ?? []
  record('T6_INVALID_CODE', t6 && toasts.some((t) => t.includes('无效') || t.includes('失败')), `toasts=${JSON.stringify(toasts)}`)

  // ============ T7: 已绑定者打开新邀请 → already_bound 提示 ============
  const ctxC = await mkCtx()
  const pc = await mkPage(ctxC)
  const C = await onboard(pc, '第三者C')
  const cCode = await pc.evaluate(async (uid) =>
    (await (await fetch('/digital-avatar/api/invite', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: uid }),
    })).json()).code, C.id)
  // A（已绑定 B）打开 C 的邀请
  await pa.goto(ORIGIN.split('?')[0] + '?invite=' + cCode, { waitUntil: 'domcontentloaded' })
  await new Promise((r) => setTimeout(r, 2500))
  const t7 = await until(pa, () => (document.querySelector('.toast')?.textContent ?? '').length > 0, 12)
  const t7msg = await toastOf(pa)
  record('T7_ALREADY_BOUND', t7 && (t7msg.includes('绑定') || t7msg.includes('无效')), `A打开C的邀请 toast=${JSON.stringify(t7msg)}`)

  // ============ T8: 桌宠模式 —— 状态行显示 partner + 壳隐藏 ============
  await pa.reload({ waitUntil: 'domcontentloaded' })
  await waitModel(pa)
  await pa.evaluate(() => document.querySelectorAll('.tabbar .tab')[3]?.click()) // 入口在「我的」tab
  await new Promise((r) => setTimeout(r, 600))
  await pa.evaluate(() => {
    ;[...document.querySelectorAll('button')].find((b) => b.textContent.includes('桌宠模式'))?.click()
  })
  await new Promise((r) => setTimeout(r, 800))
  const petStatus = await pa.evaluate(() => document.querySelector('.pet-status')?.textContent ?? null)
  const shellHidden = await pa.evaluate(() => !document.querySelector('.tabbar'))
  record('T8_PET_MODE', !!petStatus && petStatus.includes('阿B') && shellHidden,
    `pet-status=${JSON.stringify(petStatus)} 壳隐藏=${shellHidden}`)
  await pa.screenshot({ path: path.join(SHOTS, 'v161-petmode.png') })
  await pa.evaluate(() => document.querySelector('.pet-exit')?.click())
  await new Promise((r) => setTimeout(r, 500))

  // ============ 汇总 ============
  console.log('\n==== SUMMARY ====')
  for (const r of results) console.log(`${r.ok ? '✅' : '❌'} ${r.id}`)
  const pass = results.filter((r) => r.ok).length
  console.log(`TOTAL: ${pass}/${results.length} passed`)
  if (errors.length) console.log('CONSOLE_ERRORS(' + errors.length + '):', JSON.stringify(errors.slice(0, 5)))
  await browser.close()
  process.exit(pass === results.length ? 0 : 1)
})().catch((e) => { console.error('FATAL', e); process.exit(1) })

