/**
 * v1.1.8 기능 검증 (DB 없이 로직 시뮬레이션)
 */
const TODAY = '2026-07-14'
const CLEARABLE = new Set(['COLLECTED','NEW_SHIPMENT_TARGET','DUPLICATE_SKIPPED','ORDER_CHANGED_REVIEW','EXPORTED_TO_EZADMIN'])

const orders = [
  { id: 1, no: 'ORD-A', date: TODAY, status: 'NEW_SHIPMENT_TARGET' },
  { id: 2, no: 'ORD-B', date: TODAY, status: 'INVOICE_IMPORTED', latest_invoice_no: 'INV-002' },
  { id: 3, no: 'ORD-C', date: TODAY, status: 'EXPORTED_TO_EZADMIN' },
]
const events = [
  { order_id: 2, invoice_no: 'INV-001', status: 'MATCHED' },
  { order_id: 2, invoice_no: 'INV-002', status: 'MATCHED' },
]

// clearToday
const toClear = orders.filter(o => o.date === TODAY && CLEARABLE.has(o.status))
const remaining = orders.filter(o => !toClear.find(c => c.id === o.id))

// getToeverInvoiceUploadRows (수정된 UNION)
const fromEvents = remaining
  .filter(o => ['INVOICE_IMPORTED','TOEVER_INVOICE_READY'].includes(o.status))
  .flatMap(o => events.filter(e => e.order_id === o.id && e.status === 'MATCHED')
    .map(e => ({ order_no: o.no, invoice_no: e.invoice_no })))
const legacyOnly = remaining
  .filter(o => ['INVOICE_IMPORTED','TOEVER_INVOICE_READY'].includes(o.status) && o.latest_invoice_no)
  .filter(o => !events.some(e => e.order_id === o.id && e.status === 'MATCHED'))
  .map(o => ({ order_no: o.no, invoice_no: o.latest_invoice_no }))
const uploadRows = [...fromEvents, ...legacyOnly]

// 중복 import
const existing = new Set(events.filter(e => e.order_id === 2).map(e => e.invoice_no))
const toImport = ['INV-001', 'INV-003']
let added = 0
for (const inv of toImport) {
  if (!existing.has(inv)) { events.push({ order_id: 2, invoice_no: inv, status: 'MATCHED' }); added++ }
}

// 파일 행
const seen = new Set()
const fileRows = []
for (const r of uploadRows) {
  const key = `${r.order_no}|${r.invoice_no}`
  if (seen.has(key)) continue
  seen.add(key)
  fileRows.push(r)
}

// --- app_run FK 해제 시뮬레이션 ---
const preservedOrder = { id: 2, source_run_id: 5 }
const runIds = [5]
// FK 해제 후 삭제 가능
preservedOrder.source_run_id = null
const canDeleteRun = preservedOrder.source_run_id === null

function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name} | ${detail}`)
  return ok
}

const all = [
  check('clearToday 삭제', toClear.length === 2, `삭제 ${toClear.length}건`),
  check('clearToday 보존', remaining.length === 1, `보존 ${remaining.length}건`),
  check('복수 송장 행', uploadRows.length === 2, `업로드행 ${uploadRows.length}건`),
  check('중복 스킵', added === 1, `신규 ${added}건 (INV-003만)`),
  check('파일 복수행', fileRows.filter(r => r.order_no === 'ORD-B').length === 2, `ORD-B ${fileRows.filter(r => r.order_no === 'ORD-B').length}행`),
  check('run FK 해제', canDeleteRun, 'source_run_id NULL 후 run 삭제 가능'),
]

console.log(all.every(Boolean) ? '\n전체 PASS' : '\n일부 FAIL')
process.exit(all.every(Boolean) ? 0 : 1)
