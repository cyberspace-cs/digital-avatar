/**
 * App.tsx — 薄引导层（V2.0 Task 8 主 JS 分包）
 *
 * 重型依赖（pixi.js / pixi-live2d-display / 舞台逻辑 AppStage）通过动态 import 拆成独立 chunk：
 * 首屏先加载极小的引导包（react + 本文件），舞台包与 live2d vendor 按需并行拉取，
 * chunk 拉取失败（弱网/CDN 抖动）时 Suspense fallback 提供「重试」按钮，绝不白屏。
 * 管理后台 #/admin 同样按需加载，普通用户永不下载后台代码。
 */
import React, { Suspense, lazy, useState, useEffect, useMemo } from 'react'

const RETRY_EVENT = 'da:boot-retry'

/** chunk 加载失败兜底：12s 未就绪给出重试入口（点击重新发起动态 import，不刷页） */
function BootFallback() {
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 12000)
    return () => clearTimeout(t)
  }, [])
  return (
    <div className="boot-fallback" role="status" aria-live="polite">
      <div className="boot-orb" aria-hidden>✨</div>
      {slow ? (
        <div className="boot-retry">
          <p>分身舞台加载得不太顺利…</p>
          <button className="btn ghost" onClick={() => window.dispatchEvent(new Event(RETRY_EVENT))}>
            重新加载
          </button>
        </div>
      ) : (
        <p>分身登场中…</p>
      )}
    </div>
  )
}

export default function App() {
  // 管理后台隐藏入口：仅在 #/admin 时渲染（hash 不随页面内导航变化，刷新后路径一致）
  const isAdmin = typeof location !== 'undefined' && location.hash === '#/admin'
  // attempt 变化 → 重新创建 lazy 组件，重新发起被 reject 的动态 import（真重试，非缓存旧 promise）
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const onRetry = () => setAttempt((n) => n + 1)
    window.addEventListener(RETRY_EVENT, onRetry)
    return () => window.removeEventListener(RETRY_EVENT, onRetry)
  }, [])
  const AppStage = useMemo(() => lazy(() => import('./AppStage')), [attempt])
  const Admin = useMemo(() => lazy(() => import('./Admin')), [attempt])

  return (
    <Suspense fallback={<BootFallback />}>
      {isAdmin ? <Admin /> : <AppStage />}
    </Suspense>
  )
}
