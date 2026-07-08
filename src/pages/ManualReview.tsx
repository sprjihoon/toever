import { useState, useEffect, useCallback } from 'react'
import type { ManualReviewItem } from '../../shared/types'

type StatusFilter = 'ALL' | 'OPEN' | 'ACK' | 'RESOLVED' | 'DISMISSED'

interface Props {
  onBadgeUpdate?: (count: number) => void
}

const STATUS_LABELS: Record<string, string> = {
  OPEN:      '미처리',
  ACK:       '확인중',
  RESOLVED:  '처리완료',
  DISMISSED: '무시됨',
}

const STATUS_COLORS: Record<string, string> = {
  OPEN:      '#ef4444',
  ACK:       '#f59e0b',
  RESOLVED:  '#22c55e',
  DISMISSED: '#475569',
}

const REVIEW_TYPE_LABELS: Record<string, string> = {
  INVALID_ORDER_NO:    '주문번호 오류',
  INVALID_PO_NO:       '발주번호 오류',
  MULTI_INVOICE:       '복수 송장',
  ORDER_CHANGED_REVIEW:'주문 변경',
  ORPHAN_INVOICE:      '고아 송장',
  HEADER_MISMATCH:     '헤더 불일치',
  UPLOAD_PARTIAL_FAIL: '업로드 부분 실패',
  TOKEN_MISSING:       '토큰 누락',
  STOREOUT_UNCLEAR:    '출고 불명확',
  SCIENTIFIC_NOTATION: '과학적 표기법',
  UNKNOWN:             '알 수 없음',
}

export default function ManualReview({ onBadgeUpdate }: Props) {
  const [items, setItems]       = useState<ManualReviewItem[]>([])
  const [filter, setFilter]     = useState<StatusFilter>('OPEN')
  const [selected, setSelected] = useState<ManualReviewItem | null>(null)
  const [loading, setLoading]   = useState(false)
  const [updating, setUpdating] = useState(false)

  const loadItems = useCallback(async (f: StatusFilter = filter) => {
    const api = window.toeverApi
    if (!api) return
    setLoading(true)
    try {
      // OPEN 필터는 전용 API(미처리만), 나머지는 전체 로드 후 클라이언트 필터
      const result = await api.review.getAll(500, 0)
      if (result.success && result.data) {
        const all = result.data as ManualReviewItem[]
        const filtered = f === 'ALL' ? all : all.filter(i => i.status === f)
        setItems(filtered)
        // 미처리 건수로 사이드바 배지 갱신
        const openCount = all.filter(i => i.status === 'OPEN').length
        onBadgeUpdate?.(openCount)
      }
    } finally {
      setLoading(false)
    }
  }, [filter, onBadgeUpdate])

  useEffect(() => { loadItems(filter) }, [filter])

  const handleStatusUpdate = async (id: number, status: string) => {
    const api = window.toeverApi
    if (!api) return
    setUpdating(true)
    try {
      await api.review.updateStatus(id, status)
      await loadItems(filter)
      setSelected(prev => prev?.id === id ? { ...prev, status: status as ManualReviewItem['status'] } : prev)
    } finally {
      setUpdating(false)
    }
  }

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* 왼쪽 목록 */}
      <div style={{ width: 420, borderRight: '1px solid #1e293b', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* 헤더 */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #1e293b' }}>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: '#f1f5f9', marginBottom: 12 }}>수동 검토</h1>
          {/* 상태 탭 */}
          <div style={{ display: 'flex', gap: 4 }}>
            {(['ALL', 'OPEN', 'ACK', 'RESOLVED', 'DISMISSED'] as StatusFilter[]).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                style={{
                  padding: '4px 10px', borderRadius: 6, fontSize: 12,
                  background: filter === f ? '#3b82f6' : 'transparent',
                  color: filter === f ? 'white' : '#64748b',
                  border: `1px solid ${filter === f ? '#3b82f6' : '#334155'}`,
                  cursor: 'pointer',
                }}
              >
                {f === 'ALL' ? '전체' : STATUS_LABELS[f]}
              </button>
            ))}
          </div>
        </div>

        {/* 목록 */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading ? (
            <div style={{ padding: 20, color: '#64748b', fontSize: 13 }}>불러오는 중...</div>
          ) : items.length === 0 ? (
            <div style={{ padding: 20, color: '#64748b', fontSize: 13 }}>항목이 없습니다.</div>
          ) : (
            items.map(item => (
              <div
                key={item.id}
                onClick={() => setSelected(item)}
                style={{
                  padding: '12px 20px', borderBottom: '1px solid #1e293b',
                  cursor: 'pointer',
                  background: selected?.id === item.id ? 'rgba(59,130,246,0.08)' : 'transparent',
                }}
                onMouseEnter={e => { if (selected?.id !== item.id) (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.02)' }}
                onMouseLeave={e => { if (selected?.id !== item.id) (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{
                    fontSize: 11, fontWeight: 600, padding: '2px 6px', borderRadius: 4,
                    background: `${STATUS_COLORS[item.status] ?? '#475569'}22`,
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
                  {item.toever_order_no && `주문 ${item.toever_order_no}`}
                  {item.error_message && ` · ${item.error_message.slice(0, 60)}`}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* 오른쪽 상세 */}
      <div style={{ flex: 1, padding: 24, overflowY: 'auto' }}>
        {!selected ? (
          <div style={{ color: '#475569', fontSize: 13, paddingTop: 40, textAlign: 'center' }}>
            왼쪽에서 항목을 선택하세요.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* 유형/상태 */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#f1f5f9' }}>
                  {REVIEW_TYPE_LABELS[selected.review_type] ?? selected.review_type}
                </div>
                {selected.toever_order_no && (
                  <div style={{ fontSize: 13, color: '#64748b', marginTop: 4, fontFamily: 'monospace' }}>
                    주문번호: {selected.toever_order_no}
                  </div>
                )}
              </div>
              <span style={{
                padding: '4px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                background: `${STATUS_COLORS[selected.status] ?? '#475569'}22`,
                color: STATUS_COLORS[selected.status] ?? '#94a3b8',
                border: `1px solid ${STATUS_COLORS[selected.status] ?? '#334155'}44`,
              }}>
                {STATUS_LABELS[selected.status] ?? selected.status}
              </span>
            </div>

            {/* 오류 메시지 */}
            {selected.error_message && (
              <div className="card" style={{ background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.2)' }}>
                <div style={{ fontWeight: 600, color: '#fca5a5', marginBottom: 6, fontSize: 13 }}>오류 내용</div>
                <div style={{ fontSize: 12, color: '#94a3b8', wordBreak: 'break-word' }}>{selected.error_message}</div>
              </div>
            )}

            {/* 권장 조치 */}
            {selected.recommended_action && (
              <div className="card" style={{ background: 'rgba(59,130,246,0.05)', border: '1px solid rgba(59,130,246,0.2)' }}>
                <div style={{ fontWeight: 600, color: '#93c5fd', marginBottom: 6, fontSize: 13 }}>권장 조치</div>
                <div style={{ fontSize: 12, color: '#94a3b8' }}>{selected.recommended_action}</div>
              </div>
            )}

            {/* 메모 */}
            {selected.memo && (
              <div className="card">
                <div style={{ fontWeight: 600, color: '#f1f5f9', marginBottom: 6, fontSize: 13 }}>메모</div>
                <div style={{ fontSize: 13, color: '#94a3b8' }}>{selected.memo}</div>
              </div>
            )}

            {/* 관련 파일 */}
            {selected.related_file_path && (
              <div className="card">
                <div style={{ fontWeight: 600, color: '#f1f5f9', marginBottom: 6, fontSize: 13 }}>관련 파일</div>
                <div style={{ fontSize: 11, color: '#64748b', wordBreak: 'break-all' }}>
                  {selected.related_file_path}
                </div>
              </div>
            )}

            {/* 상태 변경 버튼 */}
            <div>
              <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8 }}>상태 변경</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {(['OPEN', 'ACK', 'RESOLVED', 'DISMISSED'] as const).map(s => (
                  <button
                    key={s}
                    onClick={() => handleStatusUpdate(selected.id, s)}
                    disabled={updating || selected.status === s}
                    style={{
                      padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 500,
                      background: selected.status === s ? `${STATUS_COLORS[s]}22` : 'transparent',
                      color: STATUS_COLORS[s],
                      border: `1px solid ${STATUS_COLORS[s]}44`,
                      cursor: selected.status === s ? 'default' : 'pointer',
                      opacity: updating ? 0.6 : 1,
                    }}
                  >
                    {STATUS_LABELS[s]}
                  </button>
                ))}
              </div>
            </div>

            {/* 감지 시각 */}
            {selected.detected_at && (
              <div style={{ fontSize: 11, color: '#475569' }}>
                감지: {new Date(selected.detected_at).toLocaleString('ko-KR')}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}