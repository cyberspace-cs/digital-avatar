import { useEffect, useState } from 'react'
import changelog from '../../docs/CHANGELOG.md?raw'
import acceptance from '../../docs/ACCEPTANCE.md?raw'

/** 管理口令 SHA-256（tx2026admin）——纯前端门禁，MVP 级别 */
const ADMIN_HASH = '8b57db2d4ead0e58da98e1ab5f94e845c9ace0ebd4e2c799b91c2e420e862660'

async function sha256Hex(s: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export default function Admin() {
  const [ok, setOk] = useState(false)
  const [key, setKey] = useState('')
  const [err, setErr] = useState('')
  const [health, setHealth] = useState('...')

  useEffect(() => {
    const base = import.meta.env.PROD ? '/digital-avatar' : ''
    fetch(`${base}/api/health`)
      .then((r) => r.text())
      .then(setHealth)
      .catch(() => setHealth('unreachable'))
  }, [])

  const unlock = async () => {
    const h = await sha256Hex(key)
    if (h === ADMIN_HASH) {
      setOk(true)
      setErr('')
    } else {
      setErr('口令不对哦')
    }
  }

  const back = () => {
    location.hash = ''
    location.reload()
  }

  return (
    <div className="admin">
      <div className="admin-card">
        <h1>后台管理</h1>
        <p className="sub">版本历史 · 验收状态 · 仅管理员可见（入口不在用户界面中）</p>

        {!ok ? (
          <div style={{ marginTop: 20 }}>
            <input
              type="password"
              placeholder="管理口令"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && unlock()}
            />
            <button className="btn" onClick={unlock}>进入</button>
            {err && <p className="admin-error">{err}</p>}
          </div>
        ) : (
          <>
            <h2>版本历史（CHANGELOG）</h2>
            <pre>{changelog}</pre>
            <h2>功能验收状态（ACCEPTANCE）</h2>
            <pre>{acceptance}</pre>
            <h2>线上信息</h2>
            <pre>{`地址: https://taoxie.vip/digital-avatar/\n健康检查: ${health}`}</pre>
          </>
        )}
        <button className="btn ghost admin-back" onClick={back}>返回应用</button>
      </div>
    </div>
  )
}
