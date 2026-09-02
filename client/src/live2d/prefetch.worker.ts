/**
 * 预取 Worker（Vite module worker）。
 *
 * 负责：HTTP fetch + JSON 解析 → 全部脱离主线程。
 * 输出：
 *   - model3 对象：保留原始相对路径，绝不写 Blob URL（避免库的 url.resolve 把 blob:http:// 错拼成 blob:http// 冒号丢失）
 *   - blobMap：{相对路径 → 绝对 Blob URL}
 *   - blobUrls：destroy 时一次性 revoke
 *   - timings：调试信息
 * 主线程将在 Live2DFactory 的 jsonToSettings 之后，用 WeakMap 挂一个 blobMap，
 * settings.resolveURL(p) 命中则直接返回 Blob URL，未命中走原始 baseDir 解析——
 * 完全和库内置 ZipLoader.upload 的做法一致（实例级替换），不触碰原型。
 */

type PrefetchRequest = { kind: 'prefetch'; modelUrl: string; lod: 'hd' | 'sd' }
type PrefetchResult = {
  kind: 'prefetched'
  model3: Record<string, any>
  blobMap: Record<string, string>
  blobUrls: string[]
  timings: { fetchTotalMs: number; entries: number }
}
type Entry = {
  /** 相对路径（model3.json 里写的值），是 blobMap 的 key */
  relative: string
  binary: boolean
  /** 可选：LOD sd.png 绝对 URL 覆盖 */
  forceAbsoluteOverride?: string
}

const scope = self as unknown as WorkerGlobalScope & typeof globalThis

scope.onmessage = async (e: MessageEvent<PrefetchRequest>) => {
  const { modelUrl, lod } = e.data
  const t0 = performance.now()
  const blobUrls: string[] = []

  // 1) 拉取 model3.json（保留原样，不修改路径）
  const baseRes = await fetch(modelUrl)
  const modelJson: Record<string, any> = await baseRes.json()
  const modelAbsolute = new URL(modelUrl, scope.location.href).href
  const baseDir = modelAbsolute.slice(0, modelAbsolute.lastIndexOf('/') + 1)
  // json.url = baseDir：ModelSettings 需要这个字段做相对路径解析的 fallback base
  modelJson.url = baseDir

  // 2) 收集需要预取的文件（key 是 model3.json 里的原始相对路径）
  const entries: Entry[] = []
  const FR = modelJson?.FileReferences || {}
  const add = (relative: string, binary: boolean, forceAbsoluteOverride?: string) => {
    if (!relative) return
    if (/^(blob|data|https?):/i.test(relative)) return // 已经是绝对 URL，直接跳过
    entries.push({ relative, binary, forceAbsoluteOverride })
  }

  if (typeof FR.Moc === 'string') add(FR.Moc, true)
  if (typeof FR.Physics === 'string') add(FR.Physics, false)
  if (typeof FR.Pose === 'string') add(FR.Pose, false)
  if (typeof FR.UserData === 'string') add(FR.UserData, false)
  if (typeof FR.DisplayInfo === 'string') add(FR.DisplayInfo, false)

  const textures: string[] = Array.isArray(FR.Textures) ? FR.Textures : []
  textures.forEach((relative) => {
    const abs = new URL(relative, baseDir).href
    const sdOverride = lod === 'sd' ? abs.replace(/\.png$/, '.sd.png') : undefined
    add(relative, true, sdOverride)
  })

  const motions: Record<string, Array<{ File?: string; Sound?: string }>> = FR.Motions ?? {}
  Object.values(motions).forEach((list) => {
    (list || []).forEach((m) => {
      if (m?.File) add(m.File, false)
      if (m?.Sound) add(m.Sound, true) // 允许音频
    })
  })

  const expressions: Array<{ File?: string }> = FR.Expressions ?? []
  expressions.forEach((ex) => { if (ex?.File) add(ex.File, false) })

  // 3) 并发 fetch → Blob → Blob URL，写 blobMap
  const blobMap: Record<string, string> = {}
  await Promise.all(
    entries.map(async (ent) => {
      const abs = new URL(ent.relative, baseDir).href
      const target = ent.forceAbsoluteOverride ?? abs
      let res = await fetch(target)
      // 如果请求的 sd.png 不存在，回落到原图
      if (!res.ok && ent.forceAbsoluteOverride && target !== abs) res = await fetch(abs)
      if (!res.ok) return // 失败则跳过，让库走原始 XHR（不会白屏）
      const payload = ent.binary ? await res.arrayBuffer() : await res.text()
      const mime = res.headers.get('content-type') || (ent.binary ? 'application/octet-stream' : 'application/json')
      const blob = new Blob([payload as BlobPart], { type: mime })
      const bu = URL.createObjectURL(blob)
      blobUrls.push(bu)
      blobMap[ent.relative] = bu
    }),
  )

  const fetchTotalMs = Math.round(performance.now() - t0)
  const result: PrefetchResult = {
    kind: 'prefetched',
    model3: modelJson,
    blobMap,
    blobUrls,
    timings: { fetchTotalMs, entries: entries.length },
  }
  scope.postMessage(result)
}

export {}
