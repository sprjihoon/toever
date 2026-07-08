import { useState, useEffect } from 'react'
import type { ManualReviewItem } from '../../shared/types'

type StatusFilter = 'ALL' | 'OPEN' | 'ACK' | 'RESOLVED' | 'DISMISSED'

const STATUS_LABELS: Record<string, string> = {
  OPEN: '???',
  ACK: '???',
  RESOLVED: '???',
  DISMISSED: '???',
}

const STATUS_COLORS: Record<string, string> = {
  OPEN: '#ef4444',
  ACK: '#f59e0b',
  RESOLVED: '#22c55e',
  DISMISSED: '#475569',
}

const REVIEW_TYPE_LABELS: Record<string, string> = {
  MULTI_INVOICE:      '?? ??',
  ORDER_CHANGED:      '?? ??',
  ORPHAN_INVOICE:     '??? ??',
  HEADER_MISMATCH:    '?? ???',
  UPLOAD_PARTIAL_FAIL:'??? ?? ??',
  TOKEN_MISSING:      '?? ??',
  STOREOUT_UNCLEAR:   '?? ???',
  SCIENTIFIC_NOTATION:'??? ???',
  UNKNOWN:            '? ? ??',
}

export default function ManualReview() {
  const [items, setItems]           = useState<ManualReviewItem[]>([])
  const [filter, setFilter]         = useState<StatusFilter>('OPEN')
  const [selected, setSelected]     = useState<ManualReviewItem | null>(null)
  const [loading, setLoading]       = useState(false)
  const [updating, setUpdating]     = useState(false)

  const loadItems = async (f: StatusFilter = filter) => {
    const api = window.toeverApi
    if (!api) return
    setLoading(true)
    try {
      const result = f === 'OPEN'
        ? await api.review.getOpen()
        : await api.review.getAll(200, 0)
      if (result.success && result.data) {
        const all = result.data as ManualReviewItem[]
        setItems(f === 'ALL' ? all : all.filter(i => i.status === f))
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadItems() }, [filter])

  const handleStatusUpdate = async (id: number, status: string) => {
    const api = window.toeverApi
    if (!api) return
    setUpdating(true)
    try {
      await api.review.updateStatus(id, status)
      await loadItems()
      if (selected?.id === id) {
        setSelected(prev => prev ? { ...prev, status: status as ManualReviewItem['status'] } : null)
      }
    } finally {
      setUpdating(false)
    }
  }

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* ?? ?? */}
      <div style={{ width: 420, borderRight: '1px solid #1e293b', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* ?? */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #1e293b' }}>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: '#f1f5f9', marginBottom: 12 }}>?? ??</h1>
          {/* ?? ? */}
          <div style={{ display: 'flex', gap: 4 }}>
            {(['ALL', 'OPEN', 'ACK', 'RESOLVED', 'DISMISSED'] as StatusFilter[]).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                style={{
                  padding: '4px 10px',
                  borderRadius: 6,
                  fontSize: 12,
                  background: filter === f ? '#3b82f6' : 'transparent',
                  color: filter === f ? 'white' : '#64748b',
                  border: `1px solid ${filter === f ? '#3b82f6' : '#334155'}`,
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                {f === 'ALL' ? '??' : STATUS_LABELS[f]}
              </button>
            ))}
          </div>
        </div>

        {/* ?? */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading ? (
            <div style={{ padding: 20, color: '#64748b', fontSize: 13 }}>?? ?...</div>
          ) : items.length === 0 ? (
            <div style={{ padding: 20, color: '#64748b', fontSize: 13 }}>??? ????.</div>
          ) : (
            items.map(item => (
              <div
                key={item.id}
                onClick={() => setSelected(item)}
                style={{
                  padding: '12px 20px',
                  borderBottom: '1px solid #1e293b',
                  cursor: 'pointer',
                  background: selected?.id === item.id ? 'rgba(59,130,246,0.08)' : 'transparent',
                  transition: 'background 0.1s',
                }}
                onMouseEnter={e => { if (selected?.id !== item.id) (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.02)' }}
                onMouseLeave={e => { if (selected?.id !== item.id) (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{
                    fontSize: 11, fontWeight: 600, padding: '2px 6px',
                    borderRadius: 4, background: 'rgba(239,68,68,0.15)',
                    color: STATUS_COLORS[item.status] ?? '#94a3b8',
                  }}>
                    {STATUS_LABELS[item.status] ?? item.status}
                  </span>
                  <span style={{ fontSize: 11, color: '#475569' }}>
                    {item.detected_at ? new Date(item.detected_at).toLocaleDateString('ko-KR') : ''}
                  </span>
                </div>
                <div style={{ fontSize: 13, color: '#f1f5f9', fontWeight: 500, marginBottom: 2 }}>
                  {REVIEW_TYPE_LABELS[item.review_type] ?? item.review_type}
                </div>
                <div style={{ fontSize: 12, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.toever_order_no && `?? ${item.toever_order_no}`}
                  {item.memo && ` ? ${item.memo}`}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ?? ?? */}
      <div style={{ flex: 1, padding: 24, overflowY: 'auto' }}>
        {!selected ? (
          <div style={{ color: '#475569', fontSize: 13, paddingTop: 40, textAlign: 'center' }}>
            ??? ???? ?? ??? ?????.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* ??/?? */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#f1f5f9' }}>
                  {REVIEW_TYPE_LABELS[selected.review_type] ?? selected.review_type}
                </div>
                {selected.toever_order_no && (
                  <div style={{ fontSize: 13, color: '#64748b', marginTop: 4, fontFamily: 'monospace' }}>
                    ????: {selected.toever_order_no}
                  </div>
                )}
              </div>
              <span style={{
                padding: '4px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                background: `${STATUS_COLORS[selected.status]}22`,
                color: STATUS_COLORS[selected.status] ?? '#94a3b8',
                border: `1px solid ${STATUS_COLORS[selected.status] ?? '#334155'}44`,
              }}>
                {STATUS_LABELS[selected.status] ?? selected.status}
              </span>
            </div>

            {/* ?? */}
            {selected.memo && (
              <div className="card" style={{ fontSize: 13, color: '#94a3b8' }}>
                <div style={{ fontWeight: 600, color: '#f1f5f9', marginBottom: 6 }}>??</div>
                {selected.memo}
              </div>
            )}

            {/* ???? */}
            {selected.related_file_path && (
              <div className="card">
                <div style={{ fontWeight: 600, color: '#f1f5f9', marginBottom: 6, fontSize: 13 }}>????</div>
                <div style={{ fontSize: 11, color: '#64748b', wordBreak: 'break-all' }}>
                  {selected.related_file_path}
                </div>
              </div>
            )}

            {/* ?? ?? ?? */}
            <div>
              <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8 }}>?? ??</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {(['OPEN', 'ACK', 'RESOLVED', 'DISMISSED'] as const).map(s => (
                  <button
                    key={s}
                    onClick={() => handleStatusUpdate(selected.id, s)}
                    disabled={updating || selected.status === s}
                    style={{
                      padding: '6px 14px',
                      borderRadius: 6,
                      fontSize: 12,
                      fontWeight: 500,
                      background: selected.status === s ? `${STATUS_COLORS[s]}22` : 'transparent',
                      color: STATUS_COLORS[s],
                      border: `1px solid ${STATUS_COLORS[s]}44`,
                      cursor: selected.status === s ? 'default' : 'pointer',
                      opacity: updating ? 0.6 : 1,
                      transition: 'all 0.15s',
                    }}
                  >
                    {STATUS_LABELS[s]}
                  </button>
                ))}
              </div>
            </div>

            {/* ?? ?? */}
            {selected.detected_at && (
              <div style={{ fontSize: 11, color: '#475569' }}>
                ??: {new Date(selected.detected_at).toLocaleString('ko-KR')}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
