import { useState, useCallback } from 'react'
import type { ReportData, ReportPeriod } from '../../shared/types'

// ============================================================
// 스타일 상수
// ============================================================
const C = {
  bg:       '#0f172a',
  card:     '#1e293b',
  border:   '#334155',
  text:     '#f1f5f9',
  muted:    '#94a3b8',
  blue:     '#3b82f6',
  green:    '#22c55e',
  yellow:   '#eab308',
  red:      '#ef4444',
  purple:   '#a855f7',
  cyan:     '#06b6d4',
}

const PERIOD_OPTIONS: { value: ReportPeriod; label: string }[] = [
  { value: 'day',     label: '일별' },
  { value: 'week',    label: '주별' },
  { value: 'month',   label: '월별' },
  { value: 'quarter', label: '분기별' },
  { value: 'half',    label: '반기별' },
  { value: 'year',    label: '연도별' },
]

const STATUS_LABEL: Record<string, string> = {
  COLLECTED:               '수집됨',
  NEW_SHIPMENT_TARGET:     '출고대상',
  DUPLICATE_SKIPPED:       '중복제외',
  ORDER_CHANGED_REVIEW:    '변경검토',
  EXPORTED_TO_EZADMIN:     '이지어드민전송',
  EZADMIN_BATCH_CANCELLED: '배치취소',
  INVOICE_IMPORTED:        '송장입력',
  TOEVER_INVOICE_READY:    '송장업로드대기',
  TOEVER_INVOICE_UPLOADED: '송장업로드완료',
  STOREOUT_INSTRUCTED:     '출고지시완료',
  MANUAL_REVIEW:           '수동검토',
  ERROR:                   '오류',
  CANCELLED:               '취소',
  ON_HOLD:                 '보류',
  RETURN_REQUESTED:        '반품요청',
}

// ============================================================
// 헬퍼 컴포넌트
// ============================================================
function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      background: C.card,
      border: `1px solid ${C.border}`,
      borderRadius: 8,
      padding: 16,
      ...style,
    }}>
      {children}
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ color: C.muted, fontSize: 11, fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 12 }}>
      {children}
    </div>
  )
}

function StatBox({ label, value, color = C.blue, unit = '' }: { label: string; value: number | string; color?: string; unit?: string }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 28, fontWeight: 700, color }}>{typeof value === 'number' ? value.toLocaleString() : value}<span style={{ fontSize: 14, color: C.muted, marginLeft: 4 }}>{unit}</span></div>
      <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>{label}</div>
    </div>
  )
}

function BarRow({ label, value, max, color, subLabel }: { label: string; value: number; max: number; color: string; subLabel?: string }) {
  const pct = max > 0 ? (value / max) * 100 : 0
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
        <span style={{ color: C.text, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
        <span style={{ color: C.muted }}>{value.toLocaleString()}{subLabel ? ` (${subLabel})` : ''}</span>
      </div>
      <div style={{ height: 6, background: C.border, borderRadius: 3 }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 3, transition: 'width 0.4s' }} />
      </div>
    </div>
  )
}

// ============================================================
// 메인 컴포넌트
// ============================================================
export default function Reports() {
  const todayKST = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })
  const firstOfMonth = () => todayKST().slice(0, 7) + '-01'

  const [period, setPeriod]       = useState<ReportPeriod>('month')
  const [dateFrom, setDateFrom]   = useState(firstOfMonth())
  const [dateTo, setDateTo]       = useState(todayKST())
  const [data, setData]           = useState<ReportData | null>(null)
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState<string | null>(null)

  const loadReport = useCallback(async () => {
    const api = window.toeverApi
    if (!api) return
    setLoading(true)
    setError(null)
    try {
      const res = await api.report.getData({ period, date_from: dateFrom, date_to: dateTo })
      if (res.success && res.data) {
        setData(res.data as ReportData)
      } else {
        setError(res.error ?? '알 수 없는 오류')
      }
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [period, dateFrom, dateTo])

  // 빠른 기간 설정
  const setPreset = (preset: string) => {
    const today = todayKST()
    const d = new Date(today)
    switch (preset) {
      case 'today':
        setDateFrom(today); setDateTo(today); setPeriod('day'); break
      case 'week': {
        const mon = new Date(d)
        mon.setDate(d.getDate() - d.getDay() + 1)
        setDateFrom(mon.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }))
        setDateTo(today); setPeriod('day'); break
      }
      case 'month':
        setDateFrom(today.slice(0, 7) + '-01'); setDateTo(today); setPeriod('day'); break
      case 'last_month': {
        const lm = new Date(d.getFullYear(), d.getMonth() - 1, 1)
        const lme = new Date(d.getFullYear(), d.getMonth(), 0)
        setDateFrom(lm.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }))
        setDateTo(lme.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }))
        setPeriod('day'); break
      }
      case 'quarter': {
        const qStart = new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1)
        setDateFrom(qStart.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }))
        setDateTo(today); setPeriod('month'); break
      }
      case 'half': {
        const hStart = new Date(d.getFullYear(), d.getMonth() < 6 ? 0 : 6, 1)
        setDateFrom(hStart.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }))
        setDateTo(today); setPeriod('month'); break
      }
      case 'year':
        setDateFrom(`${d.getFullYear()}-01-01`); setDateTo(today); setPeriod('month'); break
    }
  }

  const maxTrend     = data ? Math.max(...data.trend.map(r => r.orders), 1) : 1
  const maxProd      = data ? Math.max(...data.top_products.map(r => r.quantity), 1) : 1
  const maxRegion    = data ? Math.max(...data.by_region.map(r => r.orders), 1) : 1
  const maxCourier   = data ? Math.max(...data.by_courier.map(r => r.count), 1) : 1

  return (
    <div style={{ padding: 24, background: C.bg, minHeight: '100%', color: C.text }}>
      {/* 헤더 */}
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>리포트</h1>
        <p style={{ color: C.muted, fontSize: 13, marginTop: 4 }}>주문 처리량 · 출고 현황 · 제품 분석 · 지역 분포</p>
      </div>

      {/* 필터 바 */}
      <Card style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          {/* 빠른 선택 */}
          <div>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 6 }}>빠른 선택</div>
            <div style={{ display: 'flex', gap: 4 }}>
              {[
                { k: 'today', l: '오늘' },
                { k: 'week',  l: '이번주' },
                { k: 'month', l: '이번달' },
                { k: 'last_month', l: '지난달' },
                { k: 'quarter', l: '이번분기' },
                { k: 'half', l: '반기' },
                { k: 'year', l: '올해' },
              ].map(p => (
                <button key={p.k} onClick={() => setPreset(p.k)} style={{
                  padding: '4px 10px', fontSize: 12, borderRadius: 4,
                  background: C.border, color: C.muted, border: 'none', cursor: 'pointer',
                }}>
                  {p.l}
                </button>
              ))}
            </div>
          </div>

          {/* 날짜 */}
          <div>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 6 }}>시작일</div>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              style={{ background: '#0f172a', border: `1px solid ${C.border}`, color: C.text, borderRadius: 4, padding: '5px 8px', fontSize: 13 }} />
          </div>
          <div>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 6 }}>종료일</div>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              style={{ background: '#0f172a', border: `1px solid ${C.border}`, color: C.text, borderRadius: 4, padding: '5px 8px', fontSize: 13 }} />
          </div>

          {/* 집계 단위 */}
          <div>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 6 }}>집계 단위</div>
            <div style={{ display: 'flex', gap: 4 }}>
              {PERIOD_OPTIONS.map(o => (
                <button key={o.value} onClick={() => setPeriod(o.value)} style={{
                  padding: '5px 10px', fontSize: 12, borderRadius: 4, cursor: 'pointer',
                  background: period === o.value ? C.blue : C.border,
                  color: period === o.value ? 'white' : C.muted,
                  border: 'none', fontWeight: period === o.value ? 600 : 400,
                }}>
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          {/* 조회 버튼 */}
          <button
            onClick={loadReport}
            disabled={loading}
            style={{
              padding: '6px 20px', fontSize: 13, fontWeight: 600, borderRadius: 4,
              background: loading ? C.border : C.blue, color: 'white', border: 'none', cursor: loading ? 'default' : 'pointer',
              marginLeft: 'auto',
            }}
          >
            {loading ? '조회중...' : '조회'}
          </button>
        </div>
      </Card>

      {/* 오류 */}
      {error && (
        <div style={{ background: '#7f1d1d', border: `1px solid ${C.red}`, borderRadius: 6, padding: '10px 14px', marginBottom: 16, color: '#fca5a5', fontSize: 13 }}>
          {error}
        </div>
      )}

      {/* 데이터 없음 */}
      {!data && !loading && (
        <div style={{ textAlign: 'center', padding: '60px 0', color: C.muted }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📊</div>
          <div>조회 기간을 선택하고 <strong style={{ color: C.blue }}>조회</strong> 버튼을 누르세요</div>
        </div>
      )}

      {data && (
        <>
          {/* 요약 카드 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 20 }}>
            <Card><StatBox label="총 주문건수" value={data.summary.total_orders} color={C.blue} unit="건" /></Card>
            <Card><StatBox label="출고완료건수" value={data.summary.total_shipped} color={C.green} unit="건" /></Card>
            <Card><StatBox label="총 출고수량" value={data.summary.total_quantity} color={C.cyan} unit="개" /></Card>
            <Card><StatBox label="제품 종류" value={data.summary.distinct_products} color={C.purple} unit="종" /></Card>
          </div>

          {/* 트렌드 + 상태별 */}
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12, marginBottom: 12 }}>
            {/* 기간별 트렌드 */}
            <Card>
              <SectionTitle>기간별 주문 처리량</SectionTitle>
              {data.trend.length === 0 ? (
                <div style={{ color: C.muted, fontSize: 13, textAlign: 'center', padding: '20px 0' }}>데이터 없음</div>
              ) : (
                <div style={{ maxHeight: 300, overflowY: 'auto' }}>
                  {data.trend.map(r => (
                    <div key={r.period_label} style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: 11, color: C.muted, marginBottom: 3 }}>{r.period_label}</div>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                            <span style={{ fontSize: 10, color: C.blue, width: 40 }}>주문</span>
                            <div style={{ flex: 1, height: 8, background: C.border, borderRadius: 4 }}>
                              <div style={{ height: '100%', width: `${(r.orders / maxTrend) * 100}%`, background: C.blue, borderRadius: 4 }} />
                            </div>
                            <span style={{ fontSize: 11, color: C.text, width: 36, textAlign: 'right' }}>{r.orders.toLocaleString()}</span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                            <span style={{ fontSize: 10, color: C.green, width: 40 }}>출고</span>
                            <div style={{ flex: 1, height: 8, background: C.border, borderRadius: 4 }}>
                              <div style={{ height: '100%', width: `${(r.shipped / maxTrend) * 100}%`, background: C.green, borderRadius: 4 }} />
                            </div>
                            <span style={{ fontSize: 11, color: C.text, width: 36, textAlign: 'right' }}>{r.shipped.toLocaleString()}</span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontSize: 10, color: C.cyan, width: 40 }}>수량</span>
                            <div style={{ flex: 1, height: 8, background: C.border, borderRadius: 4 }}>
                              <div style={{ height: '100%', width: `${(r.quantity / Math.max(...data.trend.map(t => t.quantity), 1)) * 100}%`, background: C.cyan, borderRadius: 4 }} />
                            </div>
                            <span style={{ fontSize: 11, color: C.text, width: 36, textAlign: 'right' }}>{r.quantity.toLocaleString()}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* 주문 상태별 */}
            <Card>
              <SectionTitle>주문 상태별</SectionTitle>
              {data.by_status.length === 0 ? (
                <div style={{ color: C.muted, fontSize: 13, textAlign: 'center', padding: '20px 0' }}>데이터 없음</div>
              ) : (
                <div>
                  {data.by_status.map(r => (
                    <BarRow
                      key={r.status}
                      label={STATUS_LABEL[r.status] ?? r.status}
                      value={r.count}
                      max={Math.max(...data.by_status.map(s => s.count), 1)}
                      color={C.yellow}
                    />
                  ))}
                </div>
              )}
            </Card>
          </div>

          {/* 최다 출고 제품 + 지역별 */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            {/* 최다 출고 제품 */}
            <Card>
              <SectionTitle>최다 출고 제품 TOP 20</SectionTitle>
              {data.top_products.length === 0 ? (
                <div style={{ color: C.muted, fontSize: 13, textAlign: 'center', padding: '20px 0' }}>데이터 없음</div>
              ) : (
                <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                  {data.top_products.map((r, i) => (
                    <div key={i} style={{ marginBottom: 8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 2 }}>
                        <span style={{ color: C.text, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          <span style={{ color: i < 3 ? C.yellow : C.muted, marginRight: 4 }}>#{i + 1}</span>
                          {r.product_name}{r.option_name ? ` (${r.option_name})` : ''}
                        </span>
                        <span style={{ color: C.muted, whiteSpace: 'nowrap', marginLeft: 8 }}>
                          {r.quantity.toLocaleString()}개 / {r.order_count}건
                        </span>
                      </div>
                      <div style={{ height: 6, background: C.border, borderRadius: 3 }}>
                        <div style={{ height: '100%', width: `${(r.quantity / maxProd) * 100}%`, background: i < 3 ? C.yellow : C.blue, borderRadius: 3 }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* 지역별 */}
            <Card>
              <SectionTitle>지역별 출고 현황</SectionTitle>
              {data.by_region.length === 0 ? (
                <div style={{ color: C.muted, fontSize: 13, textAlign: 'center', padding: '20px 0' }}>데이터 없음</div>
              ) : (
                <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                  {data.by_region.map((r, i) => (
                    <BarRow
                      key={i}
                      label={r.region}
                      value={r.orders}
                      max={maxRegion}
                      color={C.purple}
                      subLabel={`${r.quantity.toLocaleString()}개`}
                    />
                  ))}
                </div>
              )}
            </Card>
          </div>

          {/* 택배사별 */}
          <Card>
            <SectionTitle>택배사별 출고 건수</SectionTitle>
            {data.by_courier.length === 0 ? (
              <div style={{ color: C.muted, fontSize: 13, textAlign: 'center', padding: '20px 0' }}>데이터 없음</div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
                {data.by_courier.map((r, i) => (
                  <div key={i} style={{ background: '#0f172a', borderRadius: 6, padding: '10px 14px' }}>
                    <div style={{ fontSize: 13, color: C.text, marginBottom: 4 }}>{r.courier_name}</div>
                    <div style={{ fontSize: 22, fontWeight: 700, color: C.cyan }}>{r.count.toLocaleString()}</div>
                    <div style={{ height: 4, background: C.border, borderRadius: 2, marginTop: 6 }}>
                      <div style={{ height: '100%', width: `${(r.count / maxCourier) * 100}%`, background: C.cyan, borderRadius: 2 }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  )
}
