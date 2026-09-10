/**
 * features/memories/MemoryTimeline.tsx — 共同回忆时间线（V2.0 Task 6）
 *
 * 按天倒序展示回忆条目（里程碑 ⭐ / 共同时刻 🤝 / 纪念日 📅 / 互动 💬），
 * 支持两步确认软删除 + 手动添加纪念日（V2.0 Task 7）。
 * 数据与分组逻辑在 memoryStore / domain/memory。
 */
import React, { useState } from 'react'
import { MEMORY_EMOJI, memorySubtitle } from '../../domain/memory'
import { useMemoryTimeline } from './memoryStore'
import { api } from '../../api'

/** 'YYYY-MM-DD HH:MM:SS'（SQLite localtime）或 ISO 统一转可解析格式后取 时:分 */
function fmtTime(s: string): string {
  const d = new Date(s.includes('T') || s.includes('Z') ? s : s.replace(' ', 'T'))
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

export default function MemoryTimeline({
  relationshipId,
  onToast,
}: {
  relationshipId: string | null
  onToast: (t: string) => void
}) {
  const { groups, loading, reload, remove } = useMemoryTimeline(relationshipId)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  // V2.0 Task 7 纪念日：手动添加一条 anniversary 回忆（标题 + 可选日期）
  const [adding, setAdding] = useState(false)
  const [annivTitle, setAnnivTitle] = useState('')
  const [annivDate, setAnnivDate] = useState('')
  const [saving, setSaving] = useState(false)

  if (!relationshipId) {
    return (
      <div className="panel">
        <div className="panel-card remind">🤝 绑定 TA 后，你们的每一次共同时刻都会记在这里</div>
      </div>
    )
  }

  const onDelete = async (memoryId: string) => {
    try {
      await remove(memoryId)
      setConfirmId(null)
      onToast('这段回忆已删除')
    } catch {
      onToast('删除失败，请稍后重试')
    }
  }

  const submitAnniversary = async () => {
    const title = annivTitle.trim()
    if (!title) {
      onToast('先给这个日子起个名字吧')
      return
    }
    setSaving(true)
    try {
      const r = await api.createMemory({
        relationshipId,
        kind: 'anniversary',
        title,
        description: annivDate || undefined,
      })
      if (r.error) throw new Error(r.error)
      setAdding(false)
      setAnnivTitle('')
      setAnnivDate('')
      reload()
      onToast('纪念日已记下 📅')
    } catch {
      onToast('保存失败，请稍后重试')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="panel">
      <div className="panel-card memory-head">
        <span>💛 我们的回忆</span>
        <span className="memory-head-actions">
          <button className="memory-refresh" onClick={() => setAdding((v) => !v)}>
            {adding ? '收起' : '＋ 纪念日'}
          </button>
          <button className="memory-refresh" onClick={reload}>刷新</button>
        </span>
      </div>

      {adding && (
        <div className="panel-card memory-form">
          <input
            className="memory-input"
            placeholder="纪念日名称，如：在一起 100 天"
            value={annivTitle}
            maxLength={40}
            onChange={(e) => setAnnivTitle(e.target.value)}
          />
          <input
            className="memory-input"
            type="date"
            value={annivDate}
            onChange={(e) => setAnnivDate(e.target.value)}
          />
          <div className="memory-form-actions">
            <button className="memory-yes" disabled={saving} onClick={submitAnniversary}>
              {saving ? '保存中…' : '记下这一天'}
            </button>
            <button className="memory-no" onClick={() => setAdding(false)}>取消</button>
          </div>
        </div>
      )}

      {loading && groups.length === 0 && <p className="sub center">回忆整理中…</p>}
      {!loading && groups.length === 0 && (
        <div className="panel-card remind">还没有回忆——去戳戳 TA，或者来一次面对面的拥抱吧 🤗</div>
      )}

      {groups.map((g) => (
        <div key={g.day} className="memory-day">
          <div className="memory-day-label">{g.day}</div>
          {g.items.map((m) => (
            <div key={m.memoryId} className="panel-card memory-card">
              <span className="memory-emoji" aria-hidden>{MEMORY_EMOJI[m.kind] ?? '💛'}</span>
              <div className="memory-body">
                <div className="memory-title">
                  {m.title}
                  <span className="memory-kind">{memorySubtitle(m.kind)}</span>
                </div>
                {m.description && <div className="memory-desc">{m.description}</div>}
                <div className="memory-time">{fmtTime(m.occurredAt)}</div>
              </div>
              {confirmId === m.memoryId ? (
                <span className="memory-confirm">
                  删除？
                  <button className="memory-yes" onClick={() => onDelete(m.memoryId)}>删</button>
                  <button className="memory-no" onClick={() => setConfirmId(null)}>留</button>
                </span>
              ) : (
                <button
                  className="memory-del"
                  title="删除这段回忆"
                  aria-label={`删除 ${m.title}`}
                  onClick={() => setConfirmId(m.memoryId)}
                >×</button>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
