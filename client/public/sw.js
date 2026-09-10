/* 数字分身 Service Worker（V2.0.0，Task 8）
 * 目标：解决"渲染加载慢"与"弱网/断网不白屏"——
 *  - models/ assets/ live2d/ 下同源 GET → cache-first（资源随版本变化，换版靠 CACHE 名升级）
 *  - 构建产物 JS/CSS（/assets/）→ stale-while-revalidate：二次进入秒开，后台静默更新
 *  - 页面导航（HTML）→ 网络优先，断网回退缓存的 index.html 应用壳（配合 outbox 不断互动）
 *  - API、Socket.IO → 一律直连网络，不干预
 * 发版时递增 CACHE 版本号即可让旧缓存整体失效。
 */
const CACHE = 'da-cache-v2.0.0'
const CORE = ['./', './index.html', './manifest.json']

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(CORE))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url)
  if (e.request.method !== 'GET' || url.origin !== location.origin) return

  // 页面导航：网络优先；离线/超时回退缓存壳，再不行也返回缓存 index（不白屏）
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put('./index.html', copy)).catch(() => { })
          return res
        })
        .catch(() => caches.match('./index.html').then((hit) => hit || caches.match('./')))
    )
    return
  }

  // 模型/纹理/Cubism Core：cache-first（体积大、内容不可变）
  if (/\/(models|assets|live2d)\//.test(url.pathname)) {
    e.respondWith(
      caches.match(e.request).then((hit) => {
        if (hit) return hit
        return fetch(e.request)
          .then((res) => {
            if (res.ok) {
              const copy = res.clone()
              caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => { })
            }
            return res
          })
          .catch(() => hit)
      })
    )
    return
  }

  // 构建产物（/assets/*.js|*.css）：stale-while-revalidate，首包后秒开 + 后台更新
  if (/\/assets\/.*\.(js|css|woff2?)$/.test(url.pathname)) {
    e.respondWith(
      caches.match(e.request).then((hit) => {
        const network = fetch(e.request)
          .then((res) => {
            if (res.ok) {
              const copy = res.clone()
              caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => { })
            }
            return res
          })
          .catch(() => hit)
        return hit || network
      })
    )
  }
})
