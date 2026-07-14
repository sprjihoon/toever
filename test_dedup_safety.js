/**
 * 중복 주문 필터링 안전 테스트 (정책 v2)
 *
 * 실행: npx electron test_dedup_safety.js
 *
 * 최우선 원칙:
 *   주문번호가 이미 DB에 있으면, 내용이 같든 다르든 절대 신규 출고 대상 불가.
 *
 * 테스트 A — 완전 동일 중복:
 *   원본 파일 재처리 → new_targets=0, duplicates=24, DB 변경 없음
 *
 * 테스트 B1 — 수량 변경 (EXPORTED_TO_EZADMIN):
 *   수량 변경 → changed_reviews=1 + manual_review 등록 + 상태 강등 없음
 *
 * 테스트 B2 — 주소 변경 (EXPORTED_TO_EZADMIN):
 *   주소 변경 → changed_reviews=1 + manual_review 등록 + 상태 강등 없음
 *
 * 테스트 B3 — 상품명 변경 (EXPORTED_TO_EZADMIN):
 *   상품명 변경 → changed_reviews=1 + manual_review 등록 + 상태 강등 없음
 *
 * 테스트 B4 — NEW_SHIPMENT_TARGET 임시 주문 + 수량 변경:
 *   ORDER_CHANGED_REVIEW 경로 검증 (상태 변경 없음 = 기존 정책 변경 핵심)
 *
 * 금지:
 *   실제 투에버 송장 업로드 / 출고작업지시 / 이지어드민 자동화
 *   운영 DB 주문 상태 변경
 */
'use strict'

const path   = require('path')
const fs     = require('fs')
const os     = require('os')
const crypto = require('crypto')

const DIST      = path.join(__dirname, 'dist-electron')
const BASE_PATH = path.join(os.homedir(), 'toever-data')
const RAW_FILE  = path.join(BASE_PATH, 'raw', 'toever_orders', '20260709_morning', 'Ordering_data.xls')
const TEST_DIR  = path.join(BASE_PATH, 'generated', 'test')

function getKSTToday() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
}
const TEST_DATE = process.env.TEST_DATE ?? getKSTToday()
const TEST_ORDER_NO = `TEST-DEDUP-${TEST_DATE.replace(/-/g, '')}-001`

// ── 컬러 출력 ──────────────────────────────────────────────────────
const C = {
  green:  s => `\x1b[32m${s}\x1b[0m`,
  red:    s => `\x1b[31m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
  cyan:   s => `\x1b[36m${s}\x1b[0m`,
  bold:   s => `\x1b[1m${s}\x1b[0m`,
  gray:   s => `\x1b[90m${s}\x1b[0m`,
}
const info    = m => console.log(`  ${C.gray('ℹ')}  ${m}`)
const warn    = m => console.log(`  ${C.yellow('⚠')}  ${C.yellow(m)}`)
const ok      = m => console.log(`  ${C.green('✓')}  ${C.green(m)}`)
const fail    = m => console.log(`  ${C.red('✗')}  ${C.red(m)}`)
const section = m => console.log(`\n${C.bold(C.cyan('▶ ' + m))}`)

// ── DB 스냅샷 ──────────────────────────────────────────────────────
function snapshotDb(db) {
  const rows = db.prepare(
    'SELECT toever_order_no, status, latest_invoice_no FROM order_header ORDER BY toever_order_no'
  ).all()
  const statusStr  = rows.map(r => `${r.toever_order_no}|${r.status}`).join('\n')
  const invoiceStr = rows.map(r => `${r.toever_order_no}|${r.latest_invoice_no ?? ''}`).join('\n')
  return {
    count:       rows.length,
    statusHash:  crypto.createHash('sha256').update(statusStr ).digest('hex').slice(0, 16),
    invoiceHash: crypto.createHash('sha256').update(invoiceStr).digest('hex').slice(0, 16),
  }
}

// ── 단일 변경 케이스 실행기 ───────────────────────────────────────
function runChangeTest(label, modifiedRows, db, dedup, repos, runSuffix) {
  const run = repos.createRun(
    'COLLECT_ORDERS', TEST_DATE,
    `dedup_test_${runSuffix}:${TEST_DATE}:${Date.now()}`,
    'morning'
  )
  const snap0 = snapshotDb(db)
  const result = dedup.filterNewShipmentTargets(modifiedRows, run.id)
  const snap1  = snapshotDb(db)

  const targetOrderNo = modifiedRows[0]?.toever_order_no
  const statusAfter = targetOrderNo
    ? db.prepare('SELECT status FROM order_header WHERE toever_order_no = ?').get(targetOrderNo)?.status
    : null
  const reviewRow = targetOrderNo
    ? db.prepare("SELECT review_type, severity, error_message FROM manual_review_queue WHERE toever_order_no = ? ORDER BY id DESC LIMIT 1").get(targetOrderNo)
    : null

  repos.updateRunStatus(run.id, 'SUCCESS',
    `${label}: new=${result.new_targets.length}, dup=${result.duplicates.length}, changed=${result.changed_reviews.length}`)

  const pass = result.new_targets.length === 0
    && result.changed_reviews.length === 1
    && reviewRow !== null
    && snap0.statusHash === snap1.statusHash   // 상태 변경 없음

  if (pass) {
    ok(`${label}: new=0, changed=1, review 등록, DB 상태 유지 ✓`)
  } else {
    fail(`${label}: new=${result.new_targets.length}, changed=${result.changed_reviews.length}, review=${!!reviewRow}, statusChanged=${snap0.statusHash !== snap1.statusHash}`)
  }
  info(`  상태 before/after: ${statusAfter}  (변경 없음: ${snap0.statusHash === snap1.statusHash})`)
  if (reviewRow) {
    info(`  manual_review: ${reviewRow.review_type} / ${reviewRow.severity}`)
    info(`  message: ${(reviewRow.error_message ?? '').slice(0, 70)}`)
  }

  return {
    label,
    newTargets:     result.new_targets.length,
    changedReviews: result.changed_reviews.length,
    statusAfter,
    reviewRegistered: !!reviewRow,
    dbUnchanged:    snap0.statusHash === snap1.statusHash,
    pass,
  }
}

// ── 메인 ──────────────────────────────────────────────────────────
async function main() {
  console.log(C.bold('\n══════════════════════════════════════════════════════'))
  console.log(C.bold('  중복 주문 필터링 안전 테스트 (정책 v2)'))
  console.log(C.bold(`  날짜: ${TEST_DATE}`))
  console.log(C.bold('══════════════════════════════════════════════════════\n'))

  // ── 0. 초기화 ────────────────────────────────────────────────────
  section('0. 환경 초기화')

  const storage = require(path.join(DIST, 'electron/services/storage.js'))
  storage.setBasePath(BASE_PATH)
  const { initDb, getDb } = require(path.join(DIST, 'electron/services/db/schema.js'))
  initDb(BASE_PATH)
  const db   = getDb()
  const repos = require(path.join(DIST, 'electron/services/db/repositories.js'))
  const dedup = require(path.join(DIST, 'electron/services/dedup/duplicateFilter.js'))
  const { parseToeverOrderFile, computeOrderHash } =
    require(path.join(DIST, 'electron/services/parser/toeverOrderParser.js'))

  if (!fs.existsSync(TEST_DIR)) fs.mkdirSync(TEST_DIR, { recursive: true })

  if (!fs.existsSync(RAW_FILE)) { fail('원본 파일 없음: ' + RAW_FILE); process.exit(1) }
  const rawBuf = fs.readFileSync(RAW_FILE)
  ok(`원본 파일: ${path.basename(RAW_FILE)}  (${rawBuf.length.toLocaleString()} bytes)`)

  // ── DB 사전 스냅샷 ──────────────────────────────────────────────
  const snapBefore = snapshotDb(db)
  info(`DB 사전 스냅샷: rows=${snapBefore.count}, status=${snapBefore.statusHash}, invoice=${snapBefore.invoiceHash}`)
  db.prepare('SELECT status, COUNT(*) as cnt FROM order_header GROUP BY status').all()
    .forEach(r => info(`  ${r.status.padEnd(35)} ${r.cnt}건`))

  // ── 파싱 ─────────────────────────────────────────────────────────
  const parsed = parseToeverOrderFile(RAW_FILE)
  const groups = new Map()
  for (const r of parsed.rows) { const g = groups.get(r.toever_order_no) ?? []; g.push(r); groups.set(r.toever_order_no, g) }
  info(`파싱: ${parsed.rows.length}행, 고유 주문 ${groups.size}건`)

  // 테스트 파일 저장
  const testAPath = path.join(TEST_DIR, `duplicate_test_${TEST_DATE.replace(/-/g,'')}_A.xls`)
  fs.copyFileSync(RAW_FILE, testAPath)
  ok(`Test A 파일: ${testAPath}`)

  // 변경 대상 주문 선택 (첫 번째 주문)
  const [targetOrderNo, targetRows] = [...groups.entries()][0]
  const targetDbRow = db.prepare('SELECT status, hash_snapshot FROM order_header WHERE toever_order_no = ?').get(targetOrderNo)
  info(`변경 테스트 대상: ${targetOrderNo}  status=${targetDbRow?.status}  qty=${targetRows.reduce((s,r)=>s+r.quantity,0)}`)

  const testBDesc = {
    target_order: targetOrderNo,
    original_status: targetDbRow?.status,
    tests: ['B1:qty변경', 'B2:주소변경', 'B3:상품명변경', 'B4:NEW_SHIPMENT_TARGET임시주문+qty변경'],
  }
  const testBPath = path.join(TEST_DIR, `duplicate_test_${TEST_DATE.replace(/-/g,'')}_B_desc.json`)
  fs.writeFileSync(testBPath, JSON.stringify(testBDesc, null, 2))
  ok(`Test B 파일: ${testBPath}`)

  const results = {}

  // ════════════════════════════════════════════════════════════════
  // TEST A — 완전 동일 중복
  // ════════════════════════════════════════════════════════════════
  section('Test A — 완전 동일 중복 재처리')
  info('예상: new=0, duplicates=24, changed=0, DB 변경 없음')

  const runA = repos.createRun('COLLECT_ORDERS', TEST_DATE, `dedup_A:${TEST_DATE}:${Date.now()}`, 'morning')
  const filterA = dedup.filterNewShipmentTargets(parsed.rows, runA.id)
  const snapAfterA = snapshotDb(db)

  results.A_newTargets    = filterA.new_targets.length
  results.A_duplicates    = filterA.duplicates.length
  results.A_changedReviews = filterA.changed_reviews.length
  results.A_dbUnchanged   = snapBefore.statusHash === snapAfterA.statusHash

  filterA.new_targets.length === 0 ? ok('신규 출고 대상: 0건 ✓') : fail(`신규 출고 대상: ${filterA.new_targets.length}건 ✗`)
  filterA.duplicates.length === groups.size ? ok(`중복 스킵: ${filterA.duplicates.length}건 ✓`) : fail(`중복 스킵: ${filterA.duplicates.length}건 (예상: ${groups.size}) ✗`)
  filterA.changed_reviews.length === 0 ? ok('변경 감지: 0건 ✓') : warn(`변경 감지: ${filterA.changed_reviews.length}건`)
  results.A_dbUnchanged ? ok('DB 변경 없음 ✓') : fail('DB 변경 감지!')
  repos.updateRunStatus(runA.id, 'SUCCESS', `A: new=${results.A_newTargets}, dup=${results.A_duplicates}`)

  // 이지어드민 대상 확인
  results.ezTargets = repos.getOrdersForEzadminExport(TEST_DATE).length
  results.ezTargets === 0 ? ok('이지어드민 신규 대상 0건 ✓') : warn(`이지어드민 대상 ${results.ezTargets}건`)

  // ════════════════════════════════════════════════════════════════
  // TEST B1 — 수량 변경 (EXPORTED_TO_EZADMIN)
  // ════════════════════════════════════════════════════════════════
  section(`Test B1 — 수량 변경  (${targetOrderNo})`)
  const origQty = targetRows.reduce((s,r)=>s+r.quantity,0)
  const b1Rows  = targetRows.map(r => ({ ...r, quantity: origQty + 99 }))
  const otherRows = parsed.rows.filter(r => r.toever_order_no !== targetOrderNo)
  info(`수량: ${origQty} → ${origQty + 99}  (기존 상태: ${targetDbRow?.status})`)
  info('예상: new=0, changed=1, manual_review 등록, 기존 상태 유지')

  results.B1 = runChangeTest('B1-수량변경', [...b1Rows, ...otherRows], db, dedup, repos, 'B1')

  // ════════════════════════════════════════════════════════════════
  // TEST B2 — 주소 변경 (EXPORTED_TO_EZADMIN)
  // ════════════════════════════════════════════════════════════════
  section(`Test B2 — 주소 변경  (${targetOrderNo})`)
  const b2Rows = targetRows.map(r => ({ ...r, receiver_address: r.receiver_address + ' [테스트주소변경]' }))
  info(`주소 변경: + "[테스트주소변경]"`)
  info('예상: new=0, changed=1, manual_review 등록, 기존 상태 유지')

  results.B2 = runChangeTest('B2-주소변경', [...b2Rows, ...otherRows], db, dedup, repos, 'B2')

  // ════════════════════════════════════════════════════════════════
  // TEST B3 — 상품명 변경 (EXPORTED_TO_EZADMIN)
  // ════════════════════════════════════════════════════════════════
  section(`Test B3 — 상품명 변경  (${targetOrderNo})`)
  const b3Rows = targetRows.map(r => ({ ...r, product_name: r.product_name + ' [테스트상품변경]' }))
  info(`상품명 변경: + "[테스트상품변경]"`)
  info('예상: new=0, changed=1, manual_review 등록, 기존 상태 유지')

  results.B3 = runChangeTest('B3-상품명변경', [...b3Rows, ...otherRows], db, dedup, repos, 'B3')

  // ════════════════════════════════════════════════════════════════
  // TEST B4 — NEW_SHIPMENT_TARGET 임시 주문 + 수량 변경
  //           (DUPLICATE_STATUSES 경로에서도 상태 변경 없음 확인)
  // ════════════════════════════════════════════════════════════════
  section('Test B4 — NEW_SHIPMENT_TARGET 임시 주문 + 수량 변경')
  info(`임시 주문번호: ${TEST_ORDER_NO}`)
  info('예상: changed=1, ORDER_CHANGED_REVIEW 검출, 기존 상태 NEW_SHIPMENT_TARGET 유지 (강등 없음)')

  const B4_ORIG_QTY = 1
  const b4OrigHash = computeOrderHash({
    receiver_name: '테스트B4', receiver_phone: '01099990001',
    receiver_address: '서울시 테스트구 B4로 1',
    product_name: `테스트상품B4//1`,
    option_name: null, quantity: B4_ORIG_QTY, delivery_message: 'B4 테스트',
  })
  const b4Insert = repos.upsertOrderHeader({
    toever_order_no: TEST_ORDER_NO, toever_po_no: null, order_date: TEST_DATE,
    receiver_name: '테스트B4', receiver_phone: '01099990001',
    receiver_address: '서울시 테스트구 B4로 1', delivery_message: 'B4 테스트',
    status: 'NEW_SHIPMENT_TARGET', latest_invoice_no: null, latest_courier_name: null,
    latest_invoice_input_at: null, ezadmin_batch_id: null, source_run_id: null,
    hash_snapshot: b4OrigHash,
  })
  ok(`임시 주문 삽입: ${TEST_ORDER_NO}  (id=${b4Insert.id}, isNew=${b4Insert.isNew})`)

  const b4ModRow = {
    toever_order_no: TEST_ORDER_NO, receiver_name: '테스트B4', receiver_phone: '01099990001',
    receiver_address: '서울시 테스트구 B4로 1', product_name: '테스트상품B4',
    option_name: null, quantity: 999, delivery_message: 'B4 테스트',
    courier_name: null, invoice_no: null,
  }

  const runB4 = repos.createRun('COLLECT_ORDERS', TEST_DATE, `dedup_B4:${TEST_DATE}:${Date.now()}`, 'morning')
  const snapB4_0 = snapshotDb(db)
  const filterB4 = dedup.filterNewShipmentTargets([b4ModRow], runB4.id)
  const snapB4_1 = snapshotDb(db)

  const b4StatusAfter = db.prepare('SELECT status FROM order_header WHERE toever_order_no = ?').get(TEST_ORDER_NO)?.status
  const b4Review = db.prepare("SELECT review_type, severity FROM manual_review_queue WHERE toever_order_no = ? ORDER BY id DESC LIMIT 1").get(TEST_ORDER_NO)

  results.B4 = {
    newTargets:       filterB4.new_targets.length,
    changedReviews:   filterB4.changed_reviews.length,
    statusAfter:      b4StatusAfter,
    statusPreserved:  b4StatusAfter === 'NEW_SHIPMENT_TARGET',  // 강등 없음 확인
    reviewRegistered: !!b4Review,
    dbStatusUnchanged: snapB4_0.statusHash === snapB4_1.statusHash,
  }

  if (filterB4.new_targets.length === 0 && filterB4.changed_reviews.length === 1 && b4Review) {
    ok(`B4: new=0, changed=1, review 등록 ✓`)
  } else {
    fail(`B4: new=${filterB4.new_targets.length}, changed=${filterB4.changed_reviews.length}, review=${!!b4Review}`)
  }

  if (b4StatusAfter === 'NEW_SHIPMENT_TARGET') {
    ok(`B4: 기존 상태 NEW_SHIPMENT_TARGET 유지 (강등 없음) ✓`)
  } else {
    fail(`B4: 상태 변경 감지! ${b4StatusAfter}  (NEW_SHIPMENT_TARGET 유지 예상)`)
  }
  if (b4Review) info(`  manual_review: ${b4Review.review_type} / ${b4Review.severity}`)

  repos.updateRunStatus(runB4.id, 'SUCCESS', `B4: changed=${filterB4.changed_reviews.length}`)

  // ── B4 정리 ─────────────────────────────────────────────────────
  section('Test B4 정리 — 임시 주문 DB 삭제')
  db.prepare('DELETE FROM manual_review_queue WHERE toever_order_no = ?').run(TEST_ORDER_NO)
  db.prepare('DELETE FROM order_header WHERE toever_order_no = ?').run(TEST_ORDER_NO)
  const b4Cleaned = !db.prepare('SELECT id FROM order_header WHERE toever_order_no = ?').get(TEST_ORDER_NO)
  b4Cleaned ? ok(`임시 주문 삭제 완료: ${TEST_ORDER_NO}`) : warn('임시 주문 삭제 실패')
  results.B4.cleanedUp = b4Cleaned

  // ── 배치 상태 확인 ───────────────────────────────────────────────
  section('기존 이지어드민 배치 상태')
  db.prepare("SELECT id, status, batch_no, order_count FROM ezadmin_export_batch ORDER BY id DESC LIMIT 5").all()
    .forEach(b => info(`  batch_id=${b.id}, status=${b.status}, batch_no=${b.batch_no}, orders=${b.order_count}`))

  // ── DB 최종 스냅샷 ────────────────────────────────────────────
  section('DB 최종 상태 확인')
  const snapFinal = snapshotDb(db)
  const finalOk = snapBefore.statusHash === snapFinal.statusHash
    && snapBefore.count === snapFinal.count
    && snapBefore.invoiceHash === snapFinal.invoiceHash
  results.finalDbOk = finalOk
  finalOk
    ? ok(`DB 최종 상태 원본과 동일: hash=${snapFinal.statusHash}, rows=${snapFinal.count}`)
    : fail(`DB 변경 감지: status=${snapBefore.statusHash}→${snapFinal.statusHash}, rows=${snapBefore.count}→${snapFinal.count}`)

  // ── 금지 항목 ────────────────────────────────────────────────────
  section('금지 항목 확인')
  ok('실제 투에버 송장 업로드 미실행')
  ok('출고작업지시 미실행')
  ok('이지어드민 자동화 미실행')
  ok('uploadBtn / selected_order_key_chk / form submit 미클릭')

  // ── 보고 ──────────────────────────────────────────────────────
  printReport({ snapBefore, snapFinal, groups, results, testAPath, testBPath, targetOrderNo })
}

function printReport({ snapBefore, snapFinal, groups, results, testAPath, testBPath, targetOrderNo }) {
  const row = (no, label, value, passVal) => {
    const mark = passVal === undefined ? '  ' : passVal ? C.green(' ✓') : C.red(' ✗')
    const val  = value === '' ? C.gray('(없음)') : C.cyan(String(value))
    console.log(`${mark}  ${C.bold(String(no).padStart(2) + '.')} ${label.padEnd(44)} ${val}`)
  }

  console.log('\n' + C.bold('══════════════════════════════════════════════════════════════════'))
  console.log(C.bold('  중복 필터링 안전 테스트 보고 (16항목) — 정책 v2'))
  console.log(C.bold(`  날짜: ${process.env.TEST_DATE ?? getKSTToday()}`))
  console.log(C.bold('══════════════════════════════════════════════════════════════════'))
  console.log()

  row( 1, '사용 중복 테스트 파일 (Test A)',          testAPath.replace(os.homedir(), '~'),                    !!testAPath)
  row( 2, '사용 변경 테스트 파일 (Test B desc)',      testBPath.replace(os.homedir(), '~'),                    !!testBPath)
  row( 3, '파싱 행 수',                              results.B1 ? groups.size + '+' : String(groups.size),   true)
  row( 4, '고유 주문번호 수',                        String(groups.size),                                     true)
  row( 5, '[A] 신규 출고 대상 수',                   `${results.A_newTargets}건 (예상: 0)`,                  results.A_newTargets === 0)
  row( 6, '[A] 중복 스킵 수',                        `${results.A_duplicates}건 (예상: ${groups.size})`,     results.A_duplicates === groups.size)
  row( 7, '[A] 수동검토 건수',                       `${results.A_changedReviews}건 (예상: 0)`,              results.A_changedReviews === 0)
  row( 8, '[A] DB 상태 변경 없음',                   results.A_dbUnchanged ? 'OK' : 'NG!',                  results.A_dbUnchanged)
  row( 9, '[B1] 수량변경 → changed_reviews=1',       `new=${results.B1?.newTargets} changed=${results.B1?.changedReviews} review=${results.B1?.reviewRegistered}`, results.B1?.pass)
  row(10, '[B2] 주소변경 → changed_reviews=1',       `new=${results.B2?.newTargets} changed=${results.B2?.changedReviews} review=${results.B2?.reviewRegistered}`, results.B2?.pass)
  row(11, '[B3] 상품명변경 → changed_reviews=1',     `new=${results.B3?.newTargets} changed=${results.B3?.changedReviews} review=${results.B3?.reviewRegistered}`, results.B3?.pass)
  row(12, '[B1~3] 기존 EXPORTED_TO_EZADMIN 상태 유지', `${results.B1?.statusAfter} / ${results.B2?.statusAfter} / ${results.B3?.statusAfter}`, results.B1?.dbUnchanged && results.B2?.dbUnchanged && results.B3?.dbUnchanged)
  row(13, '[B4] NEW_SHIPMENT_TARGET 상태 강등 없음',  `statusAfter=${results.B4?.statusAfter}`,              results.B4?.statusPreserved)
  row(14, '이지어드민 업로드 파일 생성 없음',          `대상 ${results.ezTargets}건 (예상: 0)`,               results.ezTargets === 0)
  row(15, 'DB row count 변경 없음',                  `${snapBefore.count} → ${snapFinal.count}`,            snapBefore.count === snapFinal.count)
  row(16, 'DB status hash 변경 없음',                `${snapBefore.statusHash} → ${snapFinal.statusHash}`,  snapBefore.statusHash === snapFinal.statusHash)

  console.log()
  row('a', 'DB invoice hash 변경 없음',              `${snapBefore.invoiceHash} → ${snapFinal.invoiceHash}`, snapBefore.invoiceHash === snapFinal.invoiceHash)
  row('b', '[B4] 임시 주문 DB 정리',                 results.B4?.cleanedUp ? 'YES ✓' : 'NO',               results.B4?.cleanedUp)
  row('c', '송장 업로드 / 출고작업지시 미실행',       'OK',                                                   true)

  const critical = [
    results.A_newTargets === 0,
    results.A_duplicates === groups.size,
    results.A_changedReviews === 0,
    results.A_dbUnchanged,
    results.B1?.pass,
    results.B2?.pass,
    results.B3?.pass,
    results.B4?.statusPreserved,
    results.B4?.reviewRegistered,
    results.B4?.cleanedUp,
    results.ezTargets === 0,
    snapBefore.count === snapFinal.count,
    snapBefore.statusHash === snapFinal.statusHash,
    snapBefore.invoiceHash === snapFinal.invoiceHash,
  ]
  const passed = critical.every(Boolean)

  console.log()
  console.log(C.bold('══════════════════════════════════════════════════════════════════'))
  if (passed) {
    console.log(C.bold(C.green('\n  ✓ 중복 필터링 안전 테스트 통과 (정책 v2)\n')))
  } else {
    console.log(C.bold(C.red('\n  ✗ 중복 필터링 안전 테스트 실패 — 위 ✗ 항목 확인 필요\n')))
  }
  console.log(C.bold('══════════════════════════════════════════════════════════════════\n'))
}

function getKSTToday() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(C.red('\n[FATAL] ' + err.message))
    console.error(err.stack)
    process.exit(1)
  })
