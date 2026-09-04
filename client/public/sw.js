/* 数字分身 Service Worker（V1.3.1）
 * 目标：解决"渲染加载慢"——模型/纹理/JS 首次加载后本地缓存，二次进入零网络等待。
 * 策略：
 *  - models/ assets/ live2d/ 下同源 GET → cache-first（资源内容随版本变化，换版靠 CACHE 名升级）
 *  - API、Socket.IO、页面导航 → 一律直连网络，不干预
 * 发版时递增 CACHE 版本号即可让旧缓存整体失效。
 */
const CACHE = 'da-cache-v1.3.2'
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
  // 只缓存模型/纹理/构建产物/Cubism Core；API 与 socket 走网络
  if (!/\/(models|assets|live2d)\//.test(url.pathname)) return
  e.respondWith(
    caches.match(e.request).then((hit) => {
      if (hit) return hit
      return fetch(e.request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone()
            caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {})
          }
          return res
        })
        .catch(() => hit)
    })
  )
})
