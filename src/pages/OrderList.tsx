import { useState, useEffect } from 'react'
import type { OrderHeader, OrderItem, ManualReviewItem, InvoiceEvent } from '../../shared/types'

const STATUS_LABELS: Record<string, string> = {
  NEW_SHIPMENT_TARGET:     '?? ?? ??',
  DUPLICATE_SKIPPED:       '?? ???',
  ORDER_CHANGED_REVIEW:    '?? ??',
  COLLECTED:               '???',
  EXPORTED_TO_EZADMIN:     '????? ??',
  INVOICE_IMPORTED:        '?? ??',
  TOEVER_INVOICE_READY:    '??? ??',
  TOEVER_INVOICE_UPLOADED: '??? ?? ??',
  STOREOUT_INSTRUCTED:     '???? ??',
  MANUAL_REVIEW:           '????',
  ERROR:                   '??',
  CANCELLED:               '??',
  ON_HOLD:                 '??',
  RETURN_REQUESTED:        '????',
}

const STATUS_COLORS: Record<string, string> = {
  NEW_SHIPMENT_TARGET:     '#22c55e',
  DUPLICATE_SKIPPED:       '#475569',
  ORDER_CHANGED_REVIEW:    '#f59e0b',
  COLLECTED:               '#64748b',
  EXPORTED_TO_EZADMIN:     '#3b82f6',
  INVOICE_IMPORTED:        '#06b6d4',
  TOEVER_INVOICE_READY:    '#8b5cf6',
  TOEVER_INVOICE_UPLOADED: '#a855f7',
  STOREOUT_INSTRUCTED:     '#10b981',
  MANUAL_REVIEW:           '#f59e0b',
  ERROR:                   '#ef4444',
  CANCELLED:               '#334155',
  ON_HOLD:                 '#78716c',
  RETURN_REQUESTED:        '#dc2626',
}

interface OrderDetail {
  header: OrderHeader
  items: OrderItem[]
  invoiceEvents: InvoiceEvent[]
  manualReviews: ManualReviewItem[]
}

export default function OrderList() {
  const [keyword, setKeyword]   = useState('')
  const [status, setStatus]     = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo]     = useState('')
  const [page, setPage]         = useState(1)
  const [orders, setOrders]     = useState<OrderHeader[]>([])
  const [total, setTotal]       = useState(0)
  const [loading, setLoading]   = useState(false)
  const [selected, setSelected] = useState<OrderDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const PAGE_SIZE = 20

  const search = async (p = 1) => {
    const api = window.toeverApi
    if (!api) return
    setLoading(true)
    try {
      const result = await api.orders.search({
        keyword:   keyword || undefined,
        status:    status  || undefined,
        date_from: dateFrom || undefined,
        date_to:   dateTo   || undefined,
        page:      p,
        page_size: PAGE_SIZE,
      })
      if (result.success && result.data) {
        const d = result.data as { orders: OrderHeader[]; total: number }
        setOrders(d.orders)
        setTotal(d.total)
        setPage(p)
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { search() }, [])

  const handleSelectOrder = async (order: OrderHeader) => {
    const api = window.toeverApi
    if (!api) return
    setDetailLoading(true)
    try {
      const result = await api.orders.getDetail(order.id)
      if (result.success && result.data) {
        setSelected(result.data as OrderDetail)
      }
    } finally {
      setDetailLoading(false)
    }
  }

  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* ?? ?? */}
      <div style={{ width: 520, borderRight: '1px solid #1e293b', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* ?? ?? */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #1e293b', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: '#f1f5f9' }}>?? ??</h1>
          <input
            type="text"
            placeholder="???? / ???? / ??? ??"
            value={keyword}
            onChange={e => setKeyword(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') search() }}
            style={{ padding: '6px 10px', borderRadius: 6, background: '#0f172a', border: '1px solid #334155', color: '#f1f5f9', fontSize: 13 }}
          />
          <div style={{ display: 'flex', gap: 6 }}>
            <select
              value={status}
              onChange={e => setStatus(e.target.value)}
              style={{ flex: 1, padding: '6px 8px', borderRadius: 6, background: '#0f172a', border: '1px solid #334155', color: '#f1f5f9', fontSize: 12 }}
            >
              <option value="">?? ??</option>
              {Object.entries(STATUS_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              style={{ flex: 1, padding: '6px 8px', borderRadius: 6, background: '#0f172a', border: '1px solid #334155', color: '#f1f5f9', fontSize: 12 }} />
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              style={{ flex: 1, padding: '6px 8px', borderRadius: 6, background: '#0f172a', border: '1px solid #334155', color: '#f1f5f9', fontSize: 12 }} />
            <button className="btn-primary" onClick={() => search()} disabled={loading} style={{ padding: '6px 14px', fontSize: 12 }}>
              ??
            </button>
          </div>
          <div style={{ fontSize: 12, color: '#64748b' }}>? {total.toLocaleString()}?</div>
        </div>

        {/* ?? ?? */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading ? (
            <div style={{ padding: 20, color: '#64748b', fontSize: 13 }}>?? ?...</div>
          ) : orders.length === 0 ? (
            <div style={{ padding: 20, color: '#64748b', fontSize: 13 }}>??? ????.</div>
          ) : orders.map(order => (
            <div
              key={order.id}
              onClick={() => handleSelectOrder(order)}
              style={{
                padding: '12px 20px',
                borderBottom: '1px solid #1e293b',
                cursor: 'pointer',
                background: selected?.header.id === order.id ? 'rgba(59,130,246,0.08)' : 'transparent',
                transition: 'background 0.1s',
              }}
              onMouseEnter={e => { if (selected?.header.id !== order.id) (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.02)' }}
              onMouseLeave={e => { if (selected?.header.id !== order.id) (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#93c5fd' }}>{order.toever_order_no}</span>
                <span style={{
                  fontSize: 11, padding: '2px 6px', borderRadius: 4,
                  background: `${STATUS_COLORS[order.status] ?? '#475569'}22`,
                  color: STATUS_COLORS[order.status] ?? '#94a3b8',
                }}>
                  {STATUS_LABELS[order.status] ?? order.status}
                </span>
              </div>
              <div style={{ fontSize: 13, color: '#f1f5f9' }}>{order.receiver_name}</div>
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{order.order_date}</div>
            </div>
          ))}
        </div>

        {/* ?????? */}
        {totalPages > 1 && (
          <div style={{ padding: '10px 20px', borderTop: '1px solid #1e293b', display: 'flex', gap: 6, justifyContent: 'center' }}>
            <button className="btn-secondary" onClick={() => search(page - 1)} disabled={page <= 1} style={{ padding: '4px 10px', fontSize: 12 }}>??</button>
            <span style={{ color: '#64748b', fontSize: 12, padding: '4px 8px' }}>{page} / {totalPages}</span>
            <button className="btn-secondary" onClick={() => search(page + 1)} disabled={page >= totalPages} style={{ padding: '4px 10px', fontSize: 12 }}>??</button>
          </div>
        )}
      </div>

      {/* ?? ?? */}
      <div style={{ flex: 1, padding: 24, overflowY: 'auto' }}>
        {detailLoading ? (
          <div style={{ color: '#64748b', fontSize: 13 }}>?? ?? ???? ?...</div>
        ) : !selected ? (
          <div style={{ color: '#475569', fontSize: 13, paddingTop: 40, textAlign: 'center' }}>
            ??? ???? ?? ??? ?????.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* ?? ?? */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: '#f1f5f9' }}>{selected.header.receiver_name}</div>
                  <div style={{ fontFamily: 'monospace', fontSize: 12, color: '#93c5fd', marginTop: 2 }}>{selected.header.toever_order_no}</div>
                </div>
                <span style={{
                  padding: '4px 10px', borderRadius: 6, fontSize: 12,
                  background: `${STATUS_COLORS[selected.header.status] ?? '#475569'}22`,
                  color: STATUS_COLORS[selected.header.status] ?? '#94a3b8',
                  border: `1px solid ${STATUS_COLORS[selected.header.status] ?? '#334155'}44`,
                }}>
                  {STATUS_LABELS[selected.header.status] ?? selected.header.status}
                </span>
              </div>

              {/* ?? ?? ??? */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <InfoRow label="???" value={selected.header.order_date} />
                <InfoRow label="???" value={selected.header.receiver_phone} mono />
                <InfoRow label="??" value={selected.header.receiver_address} colSpan={2} />
                {selected.header.delivery_message && (
                  <InfoRow label="?? ??" value={selected.header.delivery_message} colSpan={2} />
                )}
                {selected.header.latest_invoice_no && (
                  <InfoRow label="????" value={`${selected.header.latest_courier_name ?? ''} ${selected.header.latest_invoice_no}`} mono />
                )}
              </div>
            </div>

            {/* ?? ?? */}
            {selected.items.length > 0 && (
              <div className="card">
                <div style={{ fontWeight: 600, color: '#f1f5f9', marginBottom: 10, fontSize: 13 }}>?? ({selected.items.length}?)</div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #334155', color: '#64748b' }}>
                      <th style={{ textAlign: 'left', padding: '4px 0' }}>???</th>
                      <th style={{ textAlign: 'left', padding: '4px 0' }}>??</th>
                      <th style={{ textAlign: 'right', padding: '4px 0' }}>??</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.items.map(item => (
                      <tr key={item.id} style={{ borderBottom: '1px solid #1e293b', color: '#94a3b8' }}>
                        <td style={{ padding: '6px 0' }}>{item.product_name}</td>
                        <td style={{ padding: '6px 0', color: '#64748b' }}>{item.option_name ?? '-'}</td>
                        <td style={{ padding: '6px 0', textAlign: 'right' }}>{item.quantity}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* ?? ?? */}
            {selected.invoiceEvents.length > 0 && (
              <div className="card">
                <div style={{ fontWeight: 600, color: '#f1f5f9', marginBottom: 10, fontSize: 13 }}>?? ??</div>
                {selected.invoiceEvents.map(ev => (
                  <div key={ev.id} style={{ padding: '6px 0', borderBottom: '1px solid #1e293b', fontSize: 12, color: '#94a3b8' }}>
                    <span style={{ fontFamily: 'monospace', color: '#93c5fd' }}>{ev.invoice_no}</span>
                    <span style={{ marginLeft: 8, color: '#64748b' }}>{ev.courier_name}</span>
                    <span style={{ marginLeft: 8, color: '#475569' }}>{ev.invoice_input_at}</span>
                  </div>
                ))}
              </div>
            )}

            {/* ?? ?? ?? */}
            {selected.manualReviews.length > 0 && (
              <div className="card" style={{ border: '1px solid rgba(245,158,11,0.2)' }}>
                <div style={{ fontWeight: 600, color: '#fde68a', marginBottom: 10, fontSize: 13 }}>?? ?? ??</div>
                {selected.manualReviews.map(rev => (
                  <div key={rev.id} style={{ padding: '6px 0', borderBottom: '1px solid #1e293b', fontSize: 12 }}>
                    <div style={{ color: '#fde68a' }}>{rev.review_type} · {rev.status}</div>
                    {rev.error_message && <div style={{ color: '#94a3b8', marginTop: 2, fontSize: 11 }}>{rev.error_message}</div>}
                    {rev.memo && <div style={{ color: '#64748b', marginTop: 2 }}>{rev.memo}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function InfoRow({ label, value, mono, colSpan }: { label: string; value: string | null; mono?: boolean; colSpan?: number }) {
  if (!value) return null
  return (
    <div style={{ gridColumn: colSpan === 2 ? 'span 2' : undefined }}>
      <div style={{ fontSize: 11, color: '#64748b', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 12, color: '#f1f5f9', fontFamily: mono ? 'monospace' : undefined }}>{value}</div>
    </div>
  )
}
