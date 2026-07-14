import { useState, useEffect, useCallback } from 'react'
import type { DragEvent } from 'react'
import type { ReportPeriod, ReportWidgetConfig, ReportTemplate, WidgetResult, WidgetType, WidgetSize } from '../../shared/types'

// ============================================================
// 색상 상수
// ============================================================
const C = {
  bg: '#0f172a', sidebar: '#0a1628', card: '#1e293b',
  border: '#334155', text: '#f1f5f9', muted: '#94a3b8',
  blue: '#3b82f6', green: '#22c55e', yellow: '#eab308',
  red: '#ef4444', purple: '#a855f7', cyan: '#06b6d4', orange: '#f97316',
}

// ============================================================
// 위젯 카탈로그
// ============================================================
interface CatalogItem {
  type: WidgetType
  label: string
  desc: string
  category: string
  defaultSize: WidgetSize
  icon: string
}
const CATALOG: CatalogItem[] = [
  // 요약 지표
  { type: 'summary_orders',        label: '총 주문건수',      desc: '기간 내 전체 주문 건수',         category: '요약 지표', defaultSize: 'small',  icon: '📦' },
  { type: 'summary_shipped',       label: '출고건수',         desc: '송장이 입력된 주문 건수',        category: '요약 지표', defaultSize: 'small',  icon: '🚚' },
  { type: 'summary_quantity',      label: '총 출고수량',      desc: '출고된 상품 수량 합계',          category: '요약 지표', defaultSize: 'small',  icon: '📊' },
  { type: 'summary_unshipped',     label: '미출고건수',       desc: '아직 출고되지 않은 건수',        category: '요약 지표', defaultSize: 'small',  icon: '⏳' },
  { type: 'summary_rate',          label: '출고율 (%)',       desc: '출고건수 / 주문건수 비율',       category: '요약 지표', defaultSize: 'small',  icon: '📈' },
  { type: 'summary_cancelled',     label: '취소건수',         desc: '취소 상태 주문 건수',            category: '요약 지표', defaultSize: 'small',  icon: '❌' },
  { type: 'summary_avg_lead_time', label: '평균 처리일',      desc: '주문일 → 송장입력일 평균',       category: '요약 지표', defaultSize: 'small',  icon: '⏱' },
  { type: 'summary_review_open',   label: '수동검토 건수',    desc: '미처리 수동검토 항목 수',        category: '요약 지표', defaultSize: 'small',  icon: '🔍' },
  // 트렌드
  { type: 'trend_orders',          label: '기간별 주문량',    desc: '집계 단위별 주문건수 추이',      category: '트렌드',    defaultSize: 'full',   icon: '📉' },
  { type: 'trend_shipped',         label: '기간별 출고량',    desc: '집계 단위별 출고건수 추이',      category: '트렌드',    defaultSize: 'full',   icon: '📉' },
  { type: 'trend_quantity',        label: '기간별 출고수량',  desc: '집계 단위별 상품수량 추이',      category: '트렌드',    defaultSize: 'full',   icon: '📉' },
  // 제품 분석
  { type: 'top_products',          label: '최다 출고 제품',   desc: '수량 기준 상위 제품 목록',       category: '제품 분석', defaultSize: 'large',  icon: '🏆' },
  { type: 'by_option',             label: '옵션별 분포',      desc: '옵션별 주문·수량 분포',          category: '제품 분석', defaultSize: 'medium', icon: '🎛' },
  // 분포 분석
  { type: 'by_region',             label: '지역별 현황',      desc: '시/도 기준 주문 분포',           category: '분포 분석', defaultSize: 'medium', icon: '🗺' },
  { type: 'by_courier',            label: '택배사별 현황',    desc: '택배사별 출고 건수',             category: '분포 분석', defaultSize: 'medium', icon: '🏢' },
  { type: 'by_status',             label: '주문 상태별',      desc: '각 상태의 주문 건수',            category: '분포 분석', defaultSize: 'medium', icon: '🎯' },
  // 운영 현황
  { type: 'automation_runs',       label: '자동화 실행 현황', desc: '자동화 작업 성공/실패 통계',     category: '운영 현황', defaultSize: 'full',   icon: '🤖' },
]
const CATEGORIES = ['요약 지표', '트렌드', '제품 분석', '분포 분석', '운영 현황']

const STATUS_LABEL: Record<string, string> = {
  COLLECTED: '수집됨', NEW_SHIPMENT_TARGET: '출고대상', DUPLICATE_SKIPPED: '중복제외',
  ORDER_CHANGED_REVIEW: '변경검토', EXPORTED_TO_EZADMIN: '이지어드민전송',
  EZADMIN_BATCH_CANCELLED: '배치취소', INVOICE_IMPORTED: '송장입력',
  TOEVER_INVOICE_READY: '송장대기', TOEVER_INVOICE_UPLOADED: '송장업로드완료',
  STOREOUT_INSTRUCTED: '출고지시완료', MANUAL_REVIEW: '수동검토',
  ERROR: '오류', CANCELLED: '취소', ON_HOLD: '보류', RETURN_REQUESTED: '반품요청',
}
const RUN_TYPE_LABEL: Record<string, string> = {
  COLLECT_ORDERS: '주문수집', EXPORT_EZADMIN: '이지어드민전송',
  IMPORT_INVOICE: '송장가져오기', UPLOAD_TOEVER_INVOICE: '투에버송장업로드',
  STOREOUT_INSTRUCT: '출고지시', BACKUP: '백업', REPORT: '리포트',
}
const PERIOD_OPTIONS: { value: ReportPeriod; label: string }[] = [
  { value: 'day', label: '일별' }, { value: 'week', label: '주별' },
  { value: 'month', label: '월별' }, { value: 'quarter', label: '분기별' },
  { value: 'half', label: '반기별' }, { value: 'year', label: '연도별' },
]
const SIZE_OPTIONS: { value: WidgetSize; label: string }[] = [
  { value: 'small', label: '소형' }, { value: 'medium', label: '중형' },
  { value: 'large', label: '대형' }, { value: 'full', label: '전폭' },
]
const SIZE_SPAN: Record<WidgetSize, number> = { small: 1, medium: 2, large: 3, full: 4 }

// ============================================================
// 헬퍼
// ============================================================
const todayKST = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })
const firstOfMonth = () => todayKST().slice(0, 7) + '-01'
const uid = () => Math.random().toString(36).slice(2, 9)

function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  return (
    <div style={{ height: 6, background: C.border, borderRadius: 3, flex: 1 }}>
      <div style={{ height: '100%', width: `${max > 0 ? (value / max) * 100 : 0}%`, background: color, borderRadius: 3, transition: 'width 0.3s' }} />
    </div>
  )
}

// ============================================================
// 위젯 렌더러
// ============================================================
function WidgetRenderer({ w, result }: { w: ReportWidgetConfig; result: WidgetResult | undefined }) {
  const data = result?.data
  const err = result?.error

  if (!result) return <div style={{ color: C.muted, fontSize: 13, padding: '20px 0', textAlign: 'center' }}>조회 전</div>
  if (err) return <div style={{ color: C.red, fontSize: 12 }}>{err}</div>

  // ── 요약 숫자 ──
  if (w.type.startsWith('summary_')) {
    const v = data as number
    const unit = w.type === 'summary_rate' ? '%' : w.type === 'summary_avg_lead_time' ? '일' : w.type === 'summary_quantity' ? '개' : '건'
    const color = w.type === 'summary_unshipped' ? C.yellow : w.type === 'summary_cancelled' ? C.red : w.type === 'summary_rate' ? C.green : w.type === 'summary_review_open' ? C.orange : C.blue
    return (
      <div style={{ textAlign: 'center', padding: '8px 0' }}>
        <div style={{ fontSize: 36, fontWeight: 700, color }}>{typeof v === 'number' ? v.toLocaleString() : '-'}</div>
        <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>{unit}</div>
      </div>
    )
  }

  // ── 트렌드 ──
  if (w.type.startsWith('trend_')) {
    const rows = data as { period_label: string; value: number }[]
    if (!rows?.length) return <div style={{ color: C.muted, fontSize: 13, textAlign: 'center', padding: 16 }}>데이터 없음</div>
    const max = Math.max(...rows.map(r => r.value), 1)
    return (
      <div style={{ maxHeight: 240, overflowY: 'auto' }}>
        {rows.map(r => (
          <div key={r.period_label} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 11, color: C.muted, width: 80, flexShrink: 0 }}>{r.period_label}</span>
            <Bar value={r.value} max={max} color={C.blue} />
            <span style={{ fontSize: 11, color: C.text, width: 44, textAlign: 'right', flexShrink: 0 }}>{r.value.toLocaleString()}</span>
          </div>
        ))}
      </div>
    )
  }

  // ── 최다 출고 제품 ──
  if (w.type === 'top_products') {
    const rows = data as { product_name: string; option_name: string | null; quantity: number; order_count: number }[]
    if (!rows?.length) return <div style={{ color: C.muted, fontSize: 13, textAlign: 'center', padding: 16 }}>데이터 없음</div>
    const max = Math.max(...rows.map(r => r.quantity), 1)
    return (
      <div style={{ maxHeight: 300, overflowY: 'auto' }}>
        {rows.map((r, i) => (
          <div key={i} style={{ marginBottom: 7 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 2 }}>
              <span style={{ color: i < 3 ? C.yellow : C.text, maxWidth: '65%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <span style={{ marginRight: 5, color: i < 3 ? C.yellow : C.muted }}>#{i + 1}</span>
                {r.product_name}{r.option_name ? ` · ${r.option_name}` : ''}
              </span>
              <span style={{ color: C.muted, whiteSpace: 'nowrap' }}>{r.quantity.toLocaleString()}개 / {r.order_count}건</span>
            </div>
            <Bar value={r.quantity} max={max} color={i < 3 ? C.yellow : C.blue} />
          </div>
        ))}
      </div>
    )
  }

  // ── 옵션별 ──
  if (w.type === 'by_option') {
    const rows = data as { product_name: string; option_name: string; quantity: number; order_count: number }[]
    if (!rows?.length) return <div style={{ color: C.muted, fontSize: 13, textAlign: 'center', padding: 16 }}>데이터 없음</div>
    const max = Math.max(...rows.map(r => r.quantity), 1)
    return (
      <div style={{ maxHeight: 260, overflowY: 'auto' }}>
        {rows.map((r, i) => (
          <div key={i} style={{ marginBottom: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 2 }}>
              <span style={{ color: C.text, maxWidth: '60%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.product_name} · {r.option_name}</span>
              <span style={{ color: C.muted }}>{r.quantity.toLocaleString()}개</span>
            </div>
            <Bar value={r.quantity} max={max} color={C.purple} />
          </div>
        ))}
      </div>
    )
  }

  // ── 지역별 ──
  if (w.type === 'by_region') {
    const rows = data as { region: string; orders: number; quantity: number }[]
    if (!rows?.length) return <div style={{ color: C.muted, fontSize: 13, textAlign: 'center', padding: 16 }}>데이터 없음</div>
    const max = Math.max(...rows.map(r => r.orders), 1)
    return (
      <div style={{ maxHeight: 260, overflowY: 'auto' }}>
        {rows.map((r, i) => (
          <div key={i} style={{ marginBottom: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 2 }}>
              <span style={{ color: C.text }}>{r.region}</span>
              <span style={{ color: C.muted }}>{r.orders}건 / {r.quantity.toLocaleString()}개</span>
            </div>
            <Bar value={r.orders} max={max} color={C.cyan} />
          </div>
        ))}
      </div>
    )
  }

  // ── 택배사별 ──
  if (w.type === 'by_courier') {
    const rows = data as { courier_name: string; count: number }[]
    if (!rows?.length) return <div style={{ color: C.muted, fontSize: 13, textAlign: 'center', padding: 16 }}>데이터 없음</div>
    const total = rows.reduce((s, r) => s + r.count, 0)
    return (
      <div>
        {rows.map((r, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 11, color: C.text, width: 90, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.courier_name}</span>
            <Bar value={r.count} max={Math.max(...rows.map(x => x.count), 1)} color={C.green} />
            <span style={{ fontSize: 11, color: C.muted, width: 56, textAlign: 'right', flexShrink: 0 }}>{r.count}건 ({total > 0 ? Math.round(r.count / total * 100) : 0}%)</span>
          </div>
        ))}
      </div>
    )
  }

  // ── 주문 상태별 ──
  if (w.type === 'by_status') {
    const rows = data as { status: string; count: number }[]
    if (!rows?.length) return <div style={{ color: C.muted, fontSize: 13, textAlign: 'center', padding: 16 }}>데이터 없음</div>
    return (
      <div>
        {rows.map((r, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 11, color: C.text, width: 110, flexShrink: 0 }}>{STATUS_LABEL[r.status] ?? r.status}</span>
            <Bar value={r.count} max={Math.max(...rows.map(x => x.count), 1)} color={C.orange} />
            <span style={{ fontSize: 11, color: C.muted, width: 36, textAlign: 'right', flexShrink: 0 }}>{r.count}</span>
          </div>
        ))}
      </div>
    )
  }

  // ── 자동화 실행 현황 ──
  if (w.type === 'automation_runs') {
    const rows = data as { run_type: string; total: number; success: number; failed: number; partial: number }[]
    if (!rows?.length) return <div style={{ color: C.muted, fontSize: 13, textAlign: 'center', padding: 16 }}>데이터 없음</div>
    return (
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${C.border}` }}>
              {['작업 유형', '전체', '성공', '실패', '부분성공', '성공률'].map(h => (
                <th key={h} style={{ padding: '4px 8px', color: C.muted, textAlign: 'right', fontWeight: 500 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
                <td style={{ padding: '5px 8px', color: C.text }}>{RUN_TYPE_LABEL[r.run_type] ?? r.run_type}</td>
                <td style={{ padding: '5px 8px', color: C.text, textAlign: 'right' }}>{r.total}</td>
                <td style={{ padding: '5px 8px', color: C.green, textAlign: 'right' }}>{r.success}</td>
                <td style={{ padding: '5px 8px', color: C.red, textAlign: 'right' }}>{r.failed}</td>
                <td style={{ padding: '5px 8px', color: C.yellow, textAlign: 'right' }}>{r.partial}</td>
                <td style={{ padding: '5px 8px', color: C.blue, textAlign: 'right' }}>{r.total > 0 ? Math.round(r.success / r.total * 100) : 0}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  return <div style={{ color: C.muted, fontSize: 12 }}>지원되지 않는 위젯</div>
}

// ============================================================
// 지표 선택 모달 (체크박스 다중 선택)
// ============================================================
function WidgetPickerModal({
  open,
  initialWidgets,
  onApply,
  onClose,
}: {
  open: boolean
  initialWidgets: ReportWidgetConfig[]
  onApply: (widgets: ReportWidgetConfig[]) => void
  onClose: () => void
}) {
  const [checked, setChecked] = useState<Set<WidgetType>>(new Set())

  useEffect(() => {
    if (open) setChecked(new Set(initialWidgets.map(w => w.type)))
  }, [open, initialWidgets])

  if (!open) return null

  const toggle = (type: WidgetType) => {
    setChecked(prev => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })
  }

  const toggleCategory = (cat: string, selectAll: boolean) => {
    setChecked(prev => {
      const next = new Set(prev)
      for (const item of CATALOG.filter(c => c.category === cat)) {
        if (selectAll) next.add(item.type)
        else next.delete(item.type)
      }
      return next
    })
  }

  const handleApply = () => {
    // 기존 위젯은 순서를 유지하고, 새로 체크된 항목만 뒤에 추가한다.
    const kept = initialWidgets.filter(w => checked.has(w.type))
    const keptTypes = new Set(kept.map(w => w.type))
    const added: ReportWidgetConfig[] = []
    checked.forEach(type => {
      if (!keptTypes.has(type)) {
        const ci = CATALOG.find(c => c.type === type)!
        added.push({ id: uid(), type, label: ci.label, size: ci.defaultSize })
      }
    })
    onApply([...kept, ...added])
    onClose()
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ width: 640, maxHeight: '82vh', display: 'flex', flexDirection: 'column', background: C.sidebar, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}
      >
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>지표 선택</div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>보고서에 표시할 지표를 체크하세요 · {checked.size}개 선택됨</div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: C.muted, fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
          {CATEGORIES.map(cat => {
            const items = CATALOG.filter(c => c.category === cat)
            const allChecked = items.every(i => checked.has(i.type))
            return (
              <div key={cat} style={{ marginBottom: 18 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontSize: 11, color: C.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>{cat}</span>
                  <button onClick={() => toggleCategory(cat, !allChecked)} style={{ fontSize: 11, color: C.blue, background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}>
                    {allChecked ? '전체 해제' : '전체 선택'}
                  </button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
                  {items.map(c => {
                    const isChecked = checked.has(c.type)
                    return (
                      <label key={c.type} style={{
                        display: 'flex', alignItems: 'flex-start', gap: 8, padding: '9px 10px', cursor: 'pointer',
                        background: isChecked ? 'rgba(59,130,246,0.14)' : C.card,
                        border: `1px solid ${isChecked ? C.blue : C.border}`, borderRadius: 7,
                      }}>
                        <input type="checkbox" checked={isChecked} onChange={() => toggle(c.type)} style={{ marginTop: 3, cursor: 'pointer' }} />
                        <div>
                          <div style={{ fontSize: 12, color: C.text, fontWeight: 600 }}>{c.icon} {c.label}</div>
                          <div style={{ fontSize: 10, color: C.muted, marginTop: 2, lineHeight: 1.4 }}>{c.desc}</div>
                        </div>
                      </label>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>

        <div style={{ padding: '14px 20px', borderTop: `1px solid ${C.border}`, display: 'flex', justifyContent: 'flex-end', gap: 8, flexShrink: 0 }}>
          <button onClick={onClose} style={{ padding: '8px 16px', background: 'transparent', border: `1px solid ${C.border}`, color: C.muted, borderRadius: 6, fontSize: 12, cursor: 'pointer' }}>
            취소
          </button>
          <button onClick={handleApply} style={{ padding: '8px 22px', background: C.blue, color: 'white', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
            적용 ({checked.size}개)
          </button>
        </div>
      </div>
    </div>
  )
}

// ============================================================
// 위젯 한 줄 (드래그로 순서 변경, 클릭으로 이름 변경)
// ============================================================
function WidgetRow({
  w,
  dragging,
  dragOver,
  onDragStart,
  onDragOver,
  onDragEnd,
  onDrop,
  onLabelChange,
  onSizeChange,
  onTopNChange,
  onRemove,
}: {
  w: ReportWidgetConfig
  dragging: boolean
  dragOver: boolean
  onDragStart: () => void
  onDragOver: (e: DragEvent) => void
  onDragEnd: () => void
  onDrop: () => void
  onLabelChange: (label: string) => void
  onSizeChange: (size: WidgetSize) => void
  onTopNChange: (n: number) => void
  onRemove: () => void
}) {
  const ci = CATALOG.find(c => c.type === w.type)!
  const [editing, setEditing] = useState(false)

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDrop={onDrop}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, background: C.card,
        border: `1px solid ${dragOver ? C.blue : C.border}`, borderRadius: 6, padding: '8px 10px',
        opacity: dragging ? 0.35 : 1,
      }}
    >
      <span style={{ cursor: 'grab', color: C.muted, fontSize: 13, userSelect: 'none', flexShrink: 0 }} title="드래그하여 순서 변경">⠿⠿</span>
      <span style={{ fontSize: 15, flexShrink: 0 }}>{ci.icon}</span>
      {editing ? (
        <input
          autoFocus
          value={w.label}
          onChange={e => onLabelChange(e.target.value)}
          onBlur={() => setEditing(false)}
          onKeyDown={e => { if (e.key === 'Enter') setEditing(false) }}
          style={{ flex: 1, minWidth: 0, background: '#0f172a', border: `1px solid ${C.blue}`, color: C.text, fontSize: 13, borderRadius: 4, padding: '3px 6px' }}
        />
      ) : (
        <span
          onClick={() => setEditing(true)}
          title="클릭하여 이름 변경"
          style={{ flex: 1, minWidth: 0, fontSize: 13, color: C.text, fontWeight: 500, cursor: 'text', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
          {w.label}
        </span>
      )}
      {w.type === 'top_products' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          <span style={{ fontSize: 10, color: C.muted }}>TOP</span>
          <input
            type="number" min={1} max={50} value={w.config?.top_n ?? 10}
            onChange={e => onTopNChange(Number(e.target.value))}
            style={{ width: 40, background: '#0f172a', border: `1px solid ${C.border}`, color: C.text, borderRadius: 3, padding: '2px 4px', fontSize: 11, textAlign: 'center' }}
          />
        </div>
      )}
      <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
        {SIZE_OPTIONS.map(o => (
          <button
            key={o.value}
            onClick={() => onSizeChange(o.value)}
            title={o.label}
            style={{
              width: 22, height: 22, fontSize: 10, borderRadius: 4, cursor: 'pointer',
              background: w.size === o.value ? C.blue : 'transparent',
              color: w.size === o.value ? 'white' : C.muted,
              border: `1px solid ${w.size === o.value ? C.blue : C.border}`,
            }}
          >
            {o.label[0]}
          </button>
        ))}
      </div>
      <button onClick={onRemove} title="제거" style={{ padding: '2px 6px', fontSize: 14, background: 'transparent', border: 'none', color: C.muted, cursor: 'pointer', flexShrink: 0 }}>×</button>
    </div>
  )
}

// ============================================================
// 메인 컴포넌트
// ============================================================
export default function Reports() {
  const [templates, setTemplates]       = useState<ReportTemplate[]>([])
  const [activeId, setActiveId]         = useState<number | null>(null)
  const [draftName, setDraftName]       = useState('새 보고서')
  const [draftDesc, setDraftDesc]       = useState('')
  const [draftWidgets, setDraftWidgets] = useState<ReportWidgetConfig[]>([])
  const [isModified, setIsModified]     = useState(false)

  const [period, setPeriod]   = useState<ReportPeriod>('month')
  const [dateFrom, setDateFrom] = useState(firstOfMonth())
  const [dateTo, setDateTo]   = useState(todayKST())

  const [pickerOpen, setPickerOpen]   = useState(false)
  const [running, setRunning]         = useState(false)
  const [results, setResults]         = useState<WidgetResult[] | null>(null)
  const [saveMsg, setSaveMsg]         = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [dragIdx, setDragIdx]         = useState<number | null>(null)
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null)

  // 템플릿 목록 로드
  const loadTemplates = useCallback(async () => {
    const api = window.toeverApi
    if (!api) return
    const res = await api.report.getTemplates()
    if (res.success) setTemplates(res.data as ReportTemplate[])
  }, [])

  useEffect(() => { loadTemplates() }, [loadTemplates])

  // 보고서 조회 (명시적 인자를 받아 상태 업데이트 타이밍 문제 없이 즉시 실행 가능)
  const runReportWith = useCallback(async (widgets: ReportWidgetConfig[], p: ReportPeriod, from: string, to: string) => {
    if (!widgets.length) { setResults(null); return }
    const api = window.toeverApi
    if (!api) return
    setRunning(true)
    try {
      const res = await api.report.buildReport({ period: p, date_from: from, date_to: to, widgets })
      if (res.success) setResults(res.data as WidgetResult[])
    } finally {
      setRunning(false)
    }
  }, [])

  // 템플릿 선택 — 선택 즉시 자동으로 조회하여 "조회" 클릭을 한 번 줄여준다.
  const selectTemplate = (t: ReportTemplate) => {
    setActiveId(t.id)
    setDraftName(t.name)
    setDraftDesc(t.description ?? '')
    const widgets = t.widgets.map(w => ({ ...w }))
    setDraftWidgets(widgets)
    setIsModified(false)
    setResults(null)
    runReportWith(widgets, period, dateFrom, dateTo)
  }

  // 새 보고서
  const newTemplate = () => {
    setActiveId(null)
    setDraftName('새 보고서')
    setDraftDesc('')
    setDraftWidgets([])
    setIsModified(false)
    setResults(null)
  }

  // 저장
  const saveTemplate = async () => {
    const api = window.toeverApi
    if (!api) return
    if (!draftName.trim()) { setSaveMsg({ type: 'err', text: '보고서 이름을 입력해주세요.' }); return }
    const res = await api.report.saveTemplate(draftName.trim(), draftDesc || null, draftWidgets as unknown[], activeId ?? undefined)
    if (res.success) {
      const saved = res.data as ReportTemplate
      setActiveId(saved.id)
      setIsModified(false)
      setSaveMsg({ type: 'ok', text: '저장되었습니다.' })
      await loadTemplates()
    } else {
      setSaveMsg({ type: 'err', text: res.error ?? '저장 실패' })
    }
    setTimeout(() => setSaveMsg(null), 2500)
  }

  // 삭제
  const deleteTemplate = async () => {
    if (!activeId) return
    if (!confirm(`"${draftName}" 보고서를 삭제할까요?`)) return
    const api = window.toeverApi
    if (!api) return
    await api.report.deleteTemplate(activeId)
    newTemplate()
    await loadTemplates()
  }

  // 지표 선택 모달에서 적용
  const applyWidgetSelection = (widgets: ReportWidgetConfig[]) => {
    setDraftWidgets(widgets)
    setIsModified(true)
    setResults(null)
  }

  // 위젯 제거
  const removeWidget = (id: string) => {
    setDraftWidgets(prev => prev.filter(w => w.id !== id))
    setIsModified(true)
    setResults(null)
  }

  // 위젯 속성 변경 (이름/크기/top_n)
  const patchWidget = (id: string, patch: Partial<ReportWidgetConfig>) => {
    setDraftWidgets(prev => prev.map(w => w.id === id ? { ...w, ...patch } : w))
    setIsModified(true)
    setResults(null)
  }

  // 드래그로 순서 변경
  const reorderWidget = (from: number, to: number) => {
    if (from === to) return
    setDraftWidgets(prev => {
      const arr = [...prev]
      const [item] = arr.splice(from, 1)
      arr.splice(to, 0, item)
      return arr
    })
    setIsModified(true)
    setResults(null)
  }

  // 보고서 조회
  const runReport = () => runReportWith(draftWidgets, period, dateFrom, dateTo)

  // 빠른 기간 설정
  const setPreset = (preset: string) => {
    const today = todayKST()
    const d = new Date(today)
    switch (preset) {
      case 'today':  setDateFrom(today); setDateTo(today); setPeriod('day'); break
      case 'week': {
        const mon = new Date(d); mon.setDate(d.getDate() - (d.getDay() || 7) + 1)
        setDateFrom(mon.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })); setDateTo(today); setPeriod('day'); break
      }
      case 'month': setDateFrom(today.slice(0, 7) + '-01'); setDateTo(today); setPeriod('day'); break
      case 'last_month': {
        const lm = new Date(d.getFullYear(), d.getMonth() - 1, 1)
        const lme = new Date(d.getFullYear(), d.getMonth(), 0)
        setDateFrom(lm.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }))
        setDateTo(lme.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })); setPeriod('day'); break
      }
      case 'quarter': {
        const qs = new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1)
        setDateFrom(qs.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })); setDateTo(today); setPeriod('month'); break
      }
      case 'half': {
        const hs = new Date(d.getFullYear(), d.getMonth() < 6 ? 0 : 6, 1)
        setDateFrom(hs.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })); setDateTo(today); setPeriod('month'); break
      }
      case 'year': setDateFrom(`${d.getFullYear()}-01-01`); setDateTo(today); setPeriod('month'); break
    }
    setResults(null)
  }

  // ============================================================
  // 렌더
  // ============================================================
  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>

      {/* ── 왼쪽 사이드바: 템플릿 목록 ── */}
      <aside style={{ width: 220, background: C.sidebar, borderRight: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
        <div style={{ padding: '14px 12px', borderBottom: `1px solid ${C.border}` }}>
          <div style={{ color: C.muted, fontSize: 10, fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>보고서 템플릿</div>
          <button onClick={newTemplate} style={{ width: '100%', padding: '7px 0', background: C.blue, color: 'white', border: 'none', borderRadius: 5, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
            + 새 보고서
          </button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '6px 0' }}>
          {templates.length === 0 && (
            <div style={{ color: C.muted, fontSize: 12, textAlign: 'center', padding: '24px 8px' }}>저장된 보고서 없음<br /><span style={{ fontSize: 11 }}>새 보고서를 만들어 저장하세요</span></div>
          )}
          {templates.map(t => (
            <button key={t.id} onClick={() => selectTemplate(t)} style={{
              width: '100%', textAlign: 'left', padding: '9px 12px', border: 'none', cursor: 'pointer',
              background: activeId === t.id ? 'rgba(59,130,246,0.15)' : 'transparent',
              borderLeft: `3px solid ${activeId === t.id ? C.blue : 'transparent'}`,
            }}>
              <div style={{ fontSize: 13, color: activeId === t.id ? C.blue : C.text, fontWeight: activeId === t.id ? 600 : 400 }}>{t.name}</div>
              <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>{t.widgets.length}개 위젯 · {t.updated_at.slice(0, 10)}</div>
            </button>
          ))}
        </div>
      </aside>

      {/* ── 오른쪽 메인 영역 ── */}
      <div style={{ flex: 1, overflow: 'auto', background: C.bg, display: 'flex', flexDirection: 'column' }}>

        {/* 상단 툴바 — 1행: 보고서 이름/저장, 2행: 기간·조회 */}
        <div style={{ borderBottom: `1px solid ${C.border}`, background: C.sidebar, flexShrink: 0 }}>
          <div style={{ padding: '12px 20px 8px', display: 'flex', alignItems: 'center', gap: 10 }}>
            <input
              value={draftName}
              onChange={e => { setDraftName(e.target.value); setIsModified(true) }}
              style={{ flex: 1, maxWidth: 280, background: '#0f172a', border: `1px solid ${C.border}`, color: C.text, borderRadius: 5, padding: '6px 10px', fontSize: 14, fontWeight: 600 }}
              placeholder="보고서 이름"
            />
            {isModified && <span style={{ fontSize: 11, color: C.yellow }}>● 미저장</span>}
            {saveMsg && <span style={{ fontSize: 11, color: saveMsg.type === 'ok' ? C.green : C.red }}>{saveMsg.text}</span>}
            <button onClick={saveTemplate} style={{ padding: '6px 16px', background: C.blue, color: 'white', border: 'none', borderRadius: 5, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>저장</button>
            {activeId && <button onClick={deleteTemplate} style={{ padding: '6px 14px', background: 'transparent', color: C.red, border: `1px solid ${C.red}`, borderRadius: 5, fontSize: 12, cursor: 'pointer' }}>삭제</button>}
          </div>

          <div style={{ padding: '8px 20px 12px', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            {[{ k: 'today', l: '오늘' }, { k: 'week', l: '이번주' }, { k: 'month', l: '이번달' }, { k: 'last_month', l: '지난달' }, { k: 'quarter', l: '분기' }, { k: 'half', l: '반기' }, { k: 'year', l: '올해' }].map(p => (
              <button key={p.k} onClick={() => setPreset(p.k)} style={{ padding: '5px 10px', fontSize: 11, background: C.border, color: C.muted, border: 'none', borderRadius: 4, cursor: 'pointer' }}>{p.l}</button>
            ))}
            <span style={{ width: 1, height: 18, background: C.border, margin: '0 2px' }} />
            <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setResults(null) }}
              style={{ background: '#0f172a', border: `1px solid ${C.border}`, color: C.text, borderRadius: 4, padding: '5px 6px', fontSize: 12 }} />
            <span style={{ color: C.muted, fontSize: 12 }}>~</span>
            <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setResults(null) }}
              style={{ background: '#0f172a', border: `1px solid ${C.border}`, color: C.text, borderRadius: 4, padding: '5px 6px', fontSize: 12 }} />
            <select value={period} onChange={e => { setPeriod(e.target.value as ReportPeriod); setResults(null) }}
              style={{ background: '#0f172a', border: `1px solid ${C.border}`, color: C.text, borderRadius: 4, padding: '5px 6px', fontSize: 12 }}>
              {PERIOD_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <div style={{ flex: 1 }} />
            <button onClick={runReport} disabled={running || !draftWidgets.length}
              style={{ padding: '7px 24px', background: running || !draftWidgets.length ? C.border : C.green, color: 'white', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 700, cursor: running || !draftWidgets.length ? 'default' : 'pointer' }}>
              {running ? '조회중...' : '▶ 조회'}
            </button>
          </div>
        </div>

        {/* 위젯 구성 영역 */}
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <span style={{ fontSize: 11, color: C.muted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 }}>지표 구성 ({draftWidgets.length}개)</span>
            <button onClick={() => setPickerOpen(true)} style={{
              padding: '5px 14px', fontSize: 12, fontWeight: 600, background: C.blue, color: 'white', border: 'none', borderRadius: 5, cursor: 'pointer',
            }}>
              + 지표 선택
            </button>
          </div>

          {/* 위젯 목록 (드래그로 순서 변경) */}
          {draftWidgets.length === 0 ? (
            <button
              onClick={() => setPickerOpen(true)}
              style={{
                width: '100%', color: C.muted, fontSize: 13, textAlign: 'center', padding: '22px 0',
                background: '#0a1628', border: `1px dashed ${C.border}`, borderRadius: 8, cursor: 'pointer',
              }}
            >
              지표를 선택해 보고서를 구성하세요
            </button>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {draftWidgets.map((w, idx) => (
                <WidgetRow
                  key={w.id}
                  w={w}
                  dragging={dragIdx === idx}
                  dragOver={dragOverIdx === idx && dragIdx !== idx}
                  onDragStart={() => setDragIdx(idx)}
                  onDragOver={e => { e.preventDefault(); setDragOverIdx(idx) }}
                  onDragEnd={() => { setDragIdx(null); setDragOverIdx(null) }}
                  onDrop={() => { if (dragIdx !== null) reorderWidget(dragIdx, idx); setDragIdx(null); setDragOverIdx(null) }}
                  onLabelChange={label => patchWidget(w.id, { label })}
                  onSizeChange={size => patchWidget(w.id, { size })}
                  onTopNChange={n => patchWidget(w.id, { config: { ...w.config, top_n: n } })}
                  onRemove={() => removeWidget(w.id)}
                />
              ))}
            </div>
          )}
        </div>

        <WidgetPickerModal
          open={pickerOpen}
          initialWidgets={draftWidgets}
          onApply={applyWidgetSelection}
          onClose={() => setPickerOpen(false)}
        />

        {/* 보고서 결과 */}
        {results && (
          <div style={{ padding: '20px 20px', flex: 1 }}>
            <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 16 }}>
              조회 결과 — {dateFrom} ~ {dateTo} ({PERIOD_OPTIONS.find(p => p.value === period)?.label})
            </div>
            {/* 4열 그리드 */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
              {draftWidgets.map(w => {
                const res = results.find(r => r.widget_id === w.id)
                const ci = CATALOG.find(c => c.type === w.type)!
                return (
                  <div key={w.id} style={{
                    gridColumn: `span ${SIZE_SPAN[w.size]}`,
                    background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 14,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                      <span style={{ fontSize: 14 }}>{ci.icon}</span>
                      <span style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{w.label}</span>
                    </div>
                    <WidgetRenderer w={w} result={res} />
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* 지표 없음 안내 */}
        {!results && draftWidgets.length === 0 && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: C.muted }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>📈</div>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>보고서를 구성해보세요</div>
            <div style={{ fontSize: 13, marginBottom: 16 }}>원하는 지표를 체크해서 선택하면 바로 보고서가 만들어집니다</div>
            <button onClick={() => setPickerOpen(true)} style={{ padding: '9px 22px', background: C.blue, color: 'white', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
              + 지표 선택하기
            </button>
          </div>
        )}
        {/* 지표는 있지만 아직 조회하지 않은 경우 */}
        {!results && draftWidgets.length > 0 && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: C.muted }}>
            <div style={{ fontSize: 13 }}>기간을 확인하고 <strong style={{ color: C.green }}>▶ 조회</strong>를 눌러 결과를 확인하세요</div>
          </div>
        )}
      </div>
    </div>
  )
}
