import { useState, useEffect, useCallback } from 'react'
import type { ManualShipment, ManualShipmentCreateParams } from '../../shared/types'

// ============================================================
// 스타일 상수
// ============================================================
const C = {
  bg:     '#0f172a',
  card:   '#1e293b',
  border: '#334155',
  text:   '#f1f5f9',
  muted:  '#94a3b8',
  blue:   '#3b82f6',
  green:  '#22c55e',
  yellow: '#eab308',
  red:    '#ef4444',
  orange: '#f97316',
}

// ============================================================
// 빈 폼 상태
// ============================================================
const EMPTY_FORM: ManualShipmentCreateParams = {
  manual_date:      '',
  receiver_name:    '',
  receiver_phone:   '',
  receiver_address: '',
  product_name:     '',
  option_name:      '',
  quantity:         1,
  invoice_no:       '',
  courier_name:     '',
  reason:           '',
  memo:             '',
  toever_order_no:  '',
  created_by:       '',
}

// ============================================================
// 입력 필드 컴포넌트
// ============================================================
function Field({
  label, required, children,
}: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>
        {label}{required && <span style={{ color: C.red, marginLeft: 2 }}>*</span>}
      </div>
      {children}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: C.bg,
  border: `1px solid ${C.border}`,
  color: C.text,
  borderRadius: 4,
  padding: '6px 8px',
  fontSize: 13,
  boxSizing: 'border-box',
}

// ============================================================
// 수기건 등록/수정 모달
// ============================================================
function ManualShipmentModal({
  item,
  onClose,
  onSaved,
}: {
  item: ManualShipment | null
  onClose: () => void
  onSaved: () => void
}) {
  const todayKST = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })
  const [form, setForm] = useState<ManualShipmentCreateParams>(
    item
      ? {
          manual_date:      item.manual_date,
          receiver_name:    item.receiver_name,
          receiver_phone:   item.receiver_phone ?? '',
          receiver_address: item.receiver_address ?? '',
          product_name:     item.product_name,
          option_name:      item.option_name ?? '',
          quantity:         item.quantity,
          invoice_no:       item.invoice_no ?? '',
          courier_name:     item.courier_name ?? '',
          reason:           item.reason ?? '',
          memo:             item.memo ?? '',
          toever_order_no:  item.toever_order_no ?? '',
          created_by:       item.created_by ?? '',
        }
      : { ...EMPTY_FORM, manual_date: todayKST }
  )
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState<string | null>(null)

  const set = (key: keyof ManualShipmentCreateParams, value: string | number) =>
    setForm(f => ({ ...f, [key]: value }))

  const handleSave = async () => {
    const api = window.toeverApi
    if (!api) return
    if (!form.manual_date || !form.receiver_name || !form.product_name) {
      setError('처리일자, 수령자명, 상품명은 필수입니다.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const payload = {
        ...form,
        quantity:         Number(form.quantity),
        receiver_phone:   form.receiver_phone   || undefined,
        receiver_address: form.receiver_address || undefined,
        option_name:      form.option_name      || undefined,
        invoice_no:       form.invoice_no       || undefined,
        courier_name:     form.courier_name     || undefined,
        reason:           form.reason           || undefined,
        memo:             form.memo             || undefined,
        toever_order_no:  form.toever_order_no  || undefined,
        created_by:       form.created_by       || undefined,
      }
      let res: { success: boolean; error?: string }
      if (item) {
        res = await api.manual.update(item.id, payload)
      } else {
        res = await api.manual.create(payload)
      }
      if (res.success) {
        onSaved()
        onClose()
      } else {
        setError(res.error ?? '저장 실패')
      }
    } catch (e) {
      setError(String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    }}>
      <div style={{
        background: C.card, border: `1px solid ${C.border}`,
        borderRadius: 10, width: 560, maxHeight: '90vh', overflow: 'auto',
        padding: 24,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
            {item ? '수기건 수정' : '수기건 등록'}
          </h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.muted, fontSize: 18, cursor: 'pointer' }}>✕</button>
        </div>

        {error && (
          <div style={{ background: '#7f1d1d', border: `1px solid ${C.red}`, borderRadius: 4, padding: '8px 12px', marginBottom: 16, color: '#fca5a5', fontSize: 13 }}>
            {error}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
          <Field label="처리일자" required>
            <input type="date" value={form.manual_date} onChange={e => set('manual_date', e.target.value)} style={inputStyle} />
          </Field>
          <Field label="수기처리 사유">
            <input value={form.reason ?? ''} onChange={e => set('reason', e.target.value)}
              placeholder="예: CS 요청, 재발송" style={inputStyle} />
          </Field>
          <Field label="수령자명" required>
            <input value={form.receiver_name} onChange={e => set('receiver_name', e.target.value)} style={inputStyle} />
          </Field>
          <Field label="연락처">
            <input value={form.receiver_phone ?? ''} onChange={e => set('receiver_phone', e.target.value)}
              placeholder="010-0000-0000" style={inputStyle} />
          </Field>
        </div>

        <Field label="주소">
          <input value={form.receiver_address ?? ''} onChange={e => set('receiver_address', e.target.value)}
            placeholder="배송지 주소" style={inputStyle} />
        </Field>

        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '0 12px' }}>
          <Field label="상품명" required>
            <input value={form.product_name} onChange={e => set('product_name', e.target.value)} style={inputStyle} />
          </Field>
          <Field label="옵션">
            <input value={form.option_name ?? ''} onChange={e => set('option_name', e.target.value)} style={inputStyle} />
          </Field>
          <Field label="수량" required>
            <input type="number" min={1} value={form.quantity}
              onChange={e => set('quantity', parseInt(e.target.value) || 1)} style={inputStyle} />
          </Field>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
          <Field label="택배사">
            <input value={form.courier_name ?? ''} onChange={e => set('courier_name', e.target.value)}
              placeholder="예: CJ대한통운" style={inputStyle} />
          </Field>
          <Field label="송장번호">
            <input value={form.invoice_no ?? ''} onChange={e => set('invoice_no', e.target.value)} style={inputStyle} />
          </Field>
          <Field label="연관 투에버 주문번호">
            <input value={form.toever_order_no ?? ''} onChange={e => set('toever_order_no', e.target.value)} style={inputStyle} />
          </Field>
          <Field label="작성자">
            <input value={form.created_by ?? ''} onChange={e => set('created_by', e.target.value)} style={inputStyle} />
          </Field>
        </div>

        <Field label="메모">
          <textarea value={form.memo ?? ''} onChange={e => set('memo', e.target.value)}
            rows={2} style={{ ...inputStyle, resize: 'vertical' }} />
        </Field>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
          <button onClick={onClose} style={{
            padding: '7px 18px', fontSize: 13, borderRadius: 4,
            background: C.border, color: C.muted, border: 'none', cursor: 'pointer',
          }}>취소</button>
          <button onClick={handleSave} disabled={saving} style={{
            padding: '7px 18px', fontSize: 13, fontWeight: 600, borderRadius: 4,
            background: saving ? C.border : C.blue, color: 'white', border: 'none',
            cursor: saving ? 'default' : 'pointer',
          }}>{saving ? '저장중...' : '저장'}</button>
        </div>
      </div>
    </div>
  )
}

// ============================================================
// 메인 페이지
// ============================================================
export default function ManualShipmentPage() {
  const todayKST  = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })
  const firstOfMonth = () => todayKST().slice(0, 7) + '-01'

  const [items, setItems]         = useState<ManualShipment[]>([])
  const [total, setTotal]         = useState(0)
  const [page, setPage]           = useState(1)
  const [keyword, setKeyword]     = useState('')
  const [dateFrom, setDateFrom]   = useState(firstOfMonth())
  const [dateTo, setDateTo]       = useState(todayKST())
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState<string | null>(null)
  const [modal, setModal]         = useState<{ open: boolean; item: ManualShipment | null }>({ open: false, item: null })
  const [delConfirm, setDelConfirm] = useState<number | null>(null)

  const PAGE_SIZE = 50

  const load = useCallback(async (p = 1) => {
    const api = window.toeverApi
    if (!api) return
    setLoading(true)
    setError(null)
    try {
      const res = await api.manual.getList({
        keyword: keyword || undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        page: p,
        page_size: PAGE_SIZE,
      })
      if (res.success && res.data) {
        const d = res.data as { items: ManualShipment[]; total: number }
        setItems(d.items)
        setTotal(d.total)
        setPage(p)
      } else {
        setError(res.error ?? '조회 실패')
      }
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [keyword, dateFrom, dateTo])

  useEffect(() => { load(1) }, [])

  const handleDelete = async (id: number) => {
    const api = window.toeverApi
    if (!api) return
    const res = await api.manual.delete(id)
    if (res.success) {
      setDelConfirm(null)
      load(page)
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div style={{ padding: 24, background: C.bg, minHeight: '100%', color: C.text }}>
      {/* 헤더 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>수기건 관리</h1>
          <p style={{ color: C.muted, fontSize: 13, marginTop: 4 }}>
            출고 외 수기 처리한 건을 등록·관리합니다. 리포트 보고서에 <span style={{ color: C.orange, fontWeight: 600 }}>[수기]</span> 로 별도 표기됩니다.
          </p>
        </div>
        <button
          onClick={() => setModal({ open: true, item: null })}
          style={{
            padding: '8px 18px', fontSize: 13, fontWeight: 600, borderRadius: 6,
            background: C.blue, color: 'white', border: 'none', cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          + 수기건 등록
        </button>
      </div>

      {/* 검색 바 */}
      <div style={{
        background: C.card, border: `1px solid ${C.border}`, borderRadius: 8,
        padding: '14px 16px', marginBottom: 16,
        display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end',
      }}>
        <div>
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>시작일</div>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            style={{ ...inputStyle, width: 140 }} />
        </div>
        <div>
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>종료일</div>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            style={{ ...inputStyle, width: 140 }} />
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>검색 (수령자·상품명·송장·주문번호)</div>
          <input
            value={keyword}
            onChange={e => setKeyword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && load(1)}
            placeholder="키워드 입력 후 Enter"
            style={{ ...inputStyle, width: '100%' }}
          />
        </div>
        <button onClick={() => load(1)} disabled={loading} style={{
          padding: '6px 20px', fontSize: 13, fontWeight: 600, borderRadius: 4,
          background: loading ? C.border : C.blue, color: 'white', border: 'none',
          cursor: loading ? 'default' : 'pointer',
        }}>
          {loading ? '조회중...' : '조회'}
        </button>
      </div>

      {/* 에러 */}
      {error && (
        <div style={{ background: '#7f1d1d', border: `1px solid ${C.red}`, borderRadius: 6, padding: '10px 14px', marginBottom: 12, color: '#fca5a5', fontSize: 13 }}>
          {error}
        </div>
      )}

      {/* 건수 요약 */}
      <div style={{ fontSize: 13, color: C.muted, marginBottom: 10 }}>
        총 <span style={{ color: C.text, fontWeight: 600 }}>{total.toLocaleString()}</span>건
      </div>

      {/* 테이블 */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#0f172a' }}>
              {['처리일자', '수령자', '상품명', '수량', '택배사', '송장번호', '사유', '투에버주문번호', '메모', ''].map(h => (
                <th key={h} style={{ padding: '10px 12px', textAlign: 'left', color: C.muted, fontWeight: 600, fontSize: 11, whiteSpace: 'nowrap', borderBottom: `1px solid ${C.border}` }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td colSpan={10} style={{ padding: '40px 0', textAlign: 'center', color: C.muted }}>
                  {loading ? '조회중...' : '등록된 수기건이 없습니다.'}
                </td>
              </tr>
            )}
            {items.map(item => (
              <tr key={item.id} style={{ borderBottom: `1px solid ${C.border}` }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.03)')}
                onMouseLeave={e => (e.currentTarget.style.background = '')}>
                <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>{item.manual_date}</td>
                <td style={{ padding: '10px 12px' }}>
                  <div>{item.receiver_name}</div>
                  {item.receiver_phone && <div style={{ color: C.muted, fontSize: 11 }}>{item.receiver_phone}</div>}
                </td>
                <td style={{ padding: '10px 12px', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.product_name}{item.option_name ? ` (${item.option_name})` : ''}
                </td>
                <td style={{ padding: '10px 12px', textAlign: 'right' }}>{item.quantity.toLocaleString()}</td>
                <td style={{ padding: '10px 12px', color: item.courier_name ? C.text : C.muted }}>
                  {item.courier_name || '-'}
                </td>
                <td style={{ padding: '10px 12px', fontFamily: 'monospace', fontSize: 12, color: item.invoice_no ? C.green : C.muted }}>
                  {item.invoice_no || '-'}
                </td>
                <td style={{ padding: '10px 12px', color: C.orange, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.reason || '-'}
                </td>
                <td style={{ padding: '10px 12px', fontFamily: 'monospace', fontSize: 12, color: item.toever_order_no ? C.blue : C.muted }}>
                  {item.toever_order_no || '-'}
                </td>
                <td style={{ padding: '10px 12px', color: C.muted, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.memo || '-'}
                </td>
                <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      onClick={() => setModal({ open: true, item })}
                      style={{ padding: '3px 10px', fontSize: 11, borderRadius: 3, background: C.border, color: C.text, border: 'none', cursor: 'pointer' }}
                    >수정</button>
                    {delConfirm === item.id ? (
                      <>
                        <button onClick={() => handleDelete(item.id)}
                          style={{ padding: '3px 10px', fontSize: 11, borderRadius: 3, background: C.red, color: 'white', border: 'none', cursor: 'pointer' }}>
                          확인
                        </button>
                        <button onClick={() => setDelConfirm(null)}
                          style={{ padding: '3px 8px', fontSize: 11, borderRadius: 3, background: C.border, color: C.muted, border: 'none', cursor: 'pointer' }}>
                          취소
                        </button>
                      </>
                    ) : (
                      <button onClick={() => setDelConfirm(item.id)}
                        style={{ padding: '3px 10px', fontSize: 11, borderRadius: 3, background: 'transparent', color: C.red, border: `1px solid ${C.red}`, cursor: 'pointer' }}>
                        삭제
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 페이지네이션 */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginTop: 16 }}>
          <button disabled={page <= 1} onClick={() => load(page - 1)}
            style={{ padding: '5px 14px', fontSize: 12, borderRadius: 4, background: C.border, color: page <= 1 ? C.muted : C.text, border: 'none', cursor: page <= 1 ? 'default' : 'pointer' }}>
            이전
          </button>
          <span style={{ lineHeight: '30px', fontSize: 13, color: C.muted }}>{page} / {totalPages}</span>
          <button disabled={page >= totalPages} onClick={() => load(page + 1)}
            style={{ padding: '5px 14px', fontSize: 12, borderRadius: 4, background: C.border, color: page >= totalPages ? C.muted : C.text, border: 'none', cursor: page >= totalPages ? 'default' : 'pointer' }}>
            다음
          </button>
        </div>
      )}

      {/* 등록/수정 모달 */}
      {modal.open && (
        <ManualShipmentModal
          item={modal.item}
          onClose={() => setModal({ open: false, item: null })}
          onSaved={() => load(page)}
        />
      )}
    </div>
  )
}
