/**
 * 투에버 실접속 플로우 테스트 (오늘 날짜 기준)
 *
 * 실행: npx electron test_live_flow.js
 *
 * 테스트 범위:
 *   1~5.  투에버 로그인 → 조회 → 엑셀 다운로드 → raw 저장 + hash
 *   6~8.  주문 파싱 + string 보존 + 중복 필터링
 *   9.    PDF 저장 (조회 결과 있을 때만)
 *  10.    이지어드민 업로드 파일 생성 (신규 출고 대상 있을 때만)
 *
 * 실행 절대 금지:
 *   - 이지어드민 자동 로그인/업로드
 *   - 투에버 송장 업로드 (uploadBtn 클릭 없음)
 *   - 출고작업지시 (체크박스/submit 없음)
 *   - 송장번호 관련 상태 변경
 */
'use strict'

const path   = require('path')
const fs     = require('fs')
const os     = require('os')
const crypto = require('crypto')

const DIST      = path.join(__dirname, 'dist-electron')
const BASE_PATH = path.join(os.homedir(), 'toever-data')
const ROUND     = 'morning'

// KST 오늘 날짜 (UTC+9)
function getKSTToday() {
  const now = new Date()
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  const y = kst.getUTCFullYear()
  const m = String(kst.getUTCMonth() + 1).padStart(2, '0')
  const d = String(kst.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
const TEST_DATE = process.env.TEST_DATE ?? getKSTToday()

const TOEVER_ID = process.env.TOEVER_ID ?? 'B0000117'
const TOEVER_PW = process.env.TOEVER_PW ?? 'unit'

// Playwright Chromium 경로
process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(
  process.env.APPDATA ?? os.homedir(),
  'spring-toever-ops', 'browsers'
)

// ── 컬러 출력 ───────────────────────────────────────────────────────
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
const section = m => console.log(`\n${C.bold(C.cyan('▶ ' + m))}`)

// ── 26가지 보고 항목 ───────────────────────────────────────────────
const R = {
  basePath:             BASE_PATH,
  loginSuccess:         false,
  queryDate:            TEST_DATE,
  rawExcelPath:         '',
  rawExcelName:         '',
  rawExcelSize:         0,
  fileHash:             '',
  parsedRowCount:       0,
  uniqueOrderCount:     0,
  newShipmentTargets:   0,
  duplicateSkipped:     0,
  manualReviewCount:    0,
  firstOrderNo:         '',
  lastOrderNo:          '',
  pdfSaved:             false,
  pdfPath:              '',
  pdfName:              '',
  pdfSize:              0,
  ezadminFileCreated:   false,
  ezadminFilePath:      '',
  ezadminRowCount:      0,
  ezadminHeaders:       [],
  orderNoStringOk:      false,
  batchId:              null,
  batchCancelAvailable: false,
  ezadminAutoNotRun:    true,
  uploadNotRun:         true,
  storeoutNotRun:       true,
}

// ── 메인 ────────────────────────────────────────────────────────────
async function main() {
  console.log(C.bold('\n══════════════════════════════════════════════'))
  console.log(C.bold('  투에버 실접속 플로우 테스트'))
  console.log(C.bold(`  날짜: ${TEST_DATE}  (KST 오늘)`))
  console.log(C.bold('══════════════════════════════════════════════\n'))
  info(`basePath : ${BASE_PATH}`)
  info(`ID       : ${TOEVER_ID}`)
  info(`Round    : ${ROUND}\n`)

  // ── 0. 환경 초기화 ──────────────────────────────────────────────
  section('0. 환경 초기화')

  const storage  = require(path.join(DIST, 'electron/services/storage.js'))
  storage.setBasePath(BASE_PATH)
  storage.ensureAllDirs()
  info(`basePath: ${BASE_PATH}`)

  const { initDb, getDb } = require(path.join(DIST, 'electron/services/db/schema.js'))
  initDb(BASE_PATH)
  const db = getDb()
  info('DB 초기화 완료')

  const repos    = require(path.join(DIST, 'electron/services/db/repositories.js'))
  const parser   = require(path.join(DIST, 'electron/services/parser/toeverOrderParser.js'))
  const dedup    = require(path.join(DIST, 'electron/services/dedup/duplicateFilter.js'))
  const browser  = require(path.join(DIST, 'electron/services/toever/browser.js'))
  const exporter = require(path.join(DIST, 'electron/services/exporter/ezadminUploadBuilder.js'))
  const DIRS     = storage.DIRS

  // ── 1~5. 로그인 → 조회 → 다운로드 → raw 저장 ─────────────────────
  section('1~5. 로그인 → 조회 → 엑셀 다운로드 → raw 저장')

  const downloadDir = path.join(DIRS.rawToeverOrders(), `${TEST_DATE.replace(/-/g, '')}_${ROUND}`)
  if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir, { recursive: true })

  let bSession = null
  let runId    = null

  try {
    // run 레코드 생성 (중복 run이면 reset)
    const iKey = `source=toever|date=${TEST_DATE}|round=${ROUND}|live_test`
    let run
    const existingRun = repos.getRunByIdempotencyKey(iKey)
    if (existingRun) {
      repos.resetRunForRetry(existingRun.id)
      run = repos.getRunById(existingRun.id) ?? existingRun
    } else {
      run = repos.createRun('COLLECT_ORDERS', TEST_DATE, iKey, ROUND)
    }
    runId = run.id
    info(`run_id: ${runId}`)

    // 브라우저 실행
    info('브라우저 실행 중...')
    bSession = await browser.launchBrowser(downloadDir)
    const { page, context } = bSession

    // 로그인
    info('투에버 로그인 중...')
    const loginResult = await browser.loginToever(page, TOEVER_ID, TOEVER_PW, runId)
    if (!loginResult.success) throw new Error(`로그인 실패: ${loginResult.error}`)
    R.loginSuccess = true
    info(`로그인 ${loginResult.sessionReused ? '(세션 재사용)' : '성공'}`)

    // 발주내역 조회 + 엑셀 다운로드
    info(`발주내역 조회 (${TEST_DATE})...`)
    const dlResult = await browser.downloadToeverOrders(page, TEST_DATE, TEST_DATE, downloadDir, runId)
    if (!dlResult.success || !dlResult.filePath) throw new Error(`다운로드 실패: ${dlResult.error}`)

    const rawFile  = dlResult.filePath
    const fileBytes = fs.readFileSync(rawFile)
    const fileSha   = crypto.createHash('sha256').update(fileBytes).digest('hex')
    const fileStat  = fs.statSync(rawFile)

    // 중복 hash 확인
    const dupArtifact = db.prepare('SELECT id FROM file_artifact WHERE sha256 = ?').get(fileSha)
    if (dupArtifact) {
      warn(`동일 hash 파일 이미 존재 (재처리 방지): ${fileSha.slice(0, 16)}...`)
    } else {
      repos.saveFileArtifact({
        artifact_type: 'TOEVER_ORDER_RAW', original_filename: path.basename(rawFile),
        stored_path: rawFile, sha256: fileSha, size_bytes: fileStat.size, run_id: runId,
      })
    }

    R.rawExcelPath = rawFile
    R.rawExcelName = path.basename(rawFile)
    R.rawExcelSize = fileStat.size
    R.fileHash     = fileSha
    info(`파일: ${R.rawExcelName}  (${fileStat.size.toLocaleString()} bytes)`)
    info(`hash: ${fileSha.slice(0, 32)}...`)

    // ── 6~8. 파싱 + 중복 필터링 + DB 저장 ──────────────────────────
    section('6~8. 주문 파싱 + 중복 필터링 + DB 저장')

    const parseResult = parser.parseToeverOrderFile(rawFile)
    if (parseResult.errors.length > 0) warn('파싱 경고: ' + parseResult.errors.join(', '))

    R.parsedRowCount = parseResult.rows.length
    info(`파싱 행 수: ${parseResult.rows.length}`)

    // 고유 주문번호 그룹화
    const orderGroups = new Map()
    for (const row of parseResult.rows) {
      const g = orderGroups.get(row.toever_order_no) ?? []
      g.push(row)
      orderGroups.set(row.toever_order_no, g)
    }
    R.uniqueOrderCount = orderGroups.size
    info(`고유 주문번호: ${orderGroups.size}건`)

    // 주문번호 string 보존 확인
    R.orderNoStringOk = parseResult.rows.length === 0 ||
      parseResult.rows.every(r => typeof r.toever_order_no === 'string')
    info(`주문번호 string 보존: ${R.orderNoStringOk ? 'OK' : 'NG'}`)

    // 첫/마지막 발주번호
    if (parseResult.rows.length > 0) {
      const sorted = [...orderGroups.keys()].sort()
      R.firstOrderNo = sorted[0]
      R.lastOrderNo  = sorted[sorted.length - 1]
      info(`발주번호 범위: ${R.firstOrderNo} ~ ${R.lastOrderNo}`)
    } else {
      warn('조회 결과 0건 — 발주번호 범위 없음')
    }

    // 중복 필터링
    const filterResult = dedup.filterNewShipmentTargets(parseResult.rows, runId)
    R.newShipmentTargets = filterResult.new_targets.length
    R.duplicateSkipped   = filterResult.duplicates.length
    info(`신규 출고 대상: ${filterResult.new_targets.length}건`)
    info(`중복 스킵: ${filterResult.duplicates.length}건`)
    if (filterResult.changed_reviews.length > 0)
      warn(`변경 감지 (수동검토): ${filterResult.changed_reviews.length}건`)

    // DB 트랜잭션 저장
    db.transaction(() => {
      for (const [orderNo, rows] of orderGroups.entries()) {
        const first       = rows[0]
        const isNewTarget = filterResult.new_targets.some(t => t.toever_order_no === orderNo)
        const isDuplicate = filterResult.duplicates.includes(orderNo)
        const isChanged   = filterResult.changed_reviews.includes(orderNo)
        const hash = parser.computeOrderHash({
          receiver_name: first.receiver_name, receiver_phone: first.receiver_phone,
          receiver_address: first.receiver_address,
          product_name: rows.map(r => `${r.product_name}/${r.option_name ?? ''}/${r.quantity}`).join('|'),
          option_name: null, quantity: rows.reduce((s, r) => s + r.quantity, 0),
          delivery_message: first.delivery_message,
        })
        const status = isNewTarget ? 'NEW_SHIPMENT_TARGET'
          : isDuplicate ? 'DUPLICATE_SKIPPED'
          : isChanged   ? 'ORDER_CHANGED_REVIEW' : 'COLLECTED'

        const { id: orderId, isNew, existingStatus } = repos.upsertOrderHeader({
          toever_order_no: orderNo, toever_po_no: null,
          order_date: TEST_DATE, receiver_name: first.receiver_name,
          receiver_phone: first.receiver_phone, receiver_address: first.receiver_address,
          delivery_message: first.delivery_message, status,
          latest_invoice_no: first.invoice_no, latest_courier_name: first.courier_name,
          latest_invoice_input_at: null, ezadmin_batch_id: null,
          source_run_id: runId, hash_snapshot: hash,
        })

        const itemRows = rows.map((r, i) => ({
          line_no: i + 1, product_name: r.product_name, option_name: r.option_name,
          quantity: r.quantity, ezadmin_product_code: null, barcode: null,
          line_hash: parser.computeOrderHash({
            receiver_name: r.receiver_name, receiver_phone: r.receiver_phone,
            receiver_address: r.receiver_address, product_name: r.product_name,
            option_name: r.option_name, quantity: r.quantity, delivery_message: r.delivery_message,
          }),
        }))

        const PROTECTED = ['EXPORTED_TO_EZADMIN','INVOICE_IMPORTED','TOEVER_INVOICE_READY',
                           'TOEVER_INVOICE_UPLOADED','STOREOUT_INSTRUCTED']
        if (isNew) {
          repos.insertOrderItems(orderId, itemRows)
        } else if (!PROTECTED.includes(existingStatus ?? '')) {
          const KEEP = ['NEW_SHIPMENT_TARGET']
          if (!(isDuplicate && KEEP.includes(existingStatus ?? ''))) repos.updateOrderStatus(orderId, status)
          if (isChanged) repos.insertOrderItems(orderId, itemRows)
        }
      }
    })()

    const manualRow = db.prepare('SELECT COUNT(*) as cnt FROM manual_review_queue WHERE run_id = ?').get(runId)
    R.manualReviewCount = manualRow?.cnt ?? 0
    repos.updateRunStatus(runId, 'SUCCESS',
      `수집=${orderGroups.size}, 신규=${filterResult.new_targets.length}, 중복=${filterResult.duplicates.length}`)
    info('DB 저장 완료')

    // ── 9. PDF 저장 ─────────────────────────────────────────────────
    section('9. PDF 저장')

    if (parseResult.rows.length === 0) {
      warn('조회 결과 없음 — PDF_SKIPPED_NO_ORDER_RANGE')
    } else {
      const pdfResult = await browser.savePdfReport({ context, dateFrom: TEST_DATE, dateTo: TEST_DATE, run_id: runId })
      if (pdfResult.success && pdfResult.filePath) {
        const pdfStat = fs.existsSync(pdfResult.filePath) ? fs.statSync(pdfResult.filePath) : null
        R.pdfSaved = true
        R.pdfPath  = pdfResult.filePath
        R.pdfName  = path.basename(pdfResult.filePath)
        R.pdfSize  = pdfStat?.size ?? 0
        info(`PDF 저장: ${R.pdfPath}  (${(R.pdfSize / 1024).toFixed(1)} KB)`)
      } else if (pdfResult.skipped) {
        warn(`PDF 건너뜀: ${pdfResult.skip_reason}`)
      } else {
        warn(`PDF 실패 (주 흐름 계속): ${pdfResult.error}`)
      }
    }

  } catch (err) {
    warn(`오류 (브라우저 흐름): ${err.message}`)
    console.error(err.stack)
  } finally {
    if (bSession) { info('브라우저 종료...'); await browser.closeBrowser() }
  }

  // ── 10. 이지어드민 업로드 파일 생성 ──────────────────────────────
  section('10. 이지어드민 업로드 파일 생성')

  try {
    const newTargets = repos.getOrdersForEzadminExport(TEST_DATE)
    info(`NEW_SHIPMENT_TARGET 쿼리: ${newTargets.length}건`)

    if (newTargets.length === 0) {
      warn('신규 출고 대상 없음 — 파일 생성 건너뜀')
    } else {
      const getOrderItems = repos.getOrderItems
        ?? require(path.join(DIST, 'electron/services/db/repositories.js')).getOrderItems
      const ordersWithItems = newTargets.map(h => ({ header: h, items: getOrderItems(h.id) }))
      const ezResult = exporter.buildEzadminUploadFile(ordersWithItems, TEST_DATE, runId, ROUND)

      R.ezadminFileCreated = true
      R.ezadminFilePath    = ezResult.filePath
      R.ezadminRowCount    = ezResult.rowCount
      R.batchId            = ezResult.batchId
      info(`생성: ${ezResult.filePath}  (${ezResult.rowCount}행, batchId=${ezResult.batchId})`)

      // 헤더 확인 + 주문번호 string 검증
      const XLSX = require(path.join(__dirname, 'node_modules', 'xlsx'))
      const wb   = XLSX.readFile(ezResult.filePath, { type: 'binary', raw: true })
      const ws   = wb.Sheets[wb.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true })
      R.ezadminHeaders = rows[0] ?? []

      // A2 셀 타입 확인
      const cellA2 = ws['A2']
      R.orderNoStringOk = R.orderNoStringOk && (!cellA2 || cellA2.t === 's')
      info(`헤더: ${R.ezadminHeaders.join(' | ')}`)
      info(`A2 셀 타입: ${cellA2?.t ?? '(없음)'}  ${cellA2?.t === 's' ? '(string ✓)' : ''}`)

      // 배치 취소 가능 여부 확인
      const batchRow = db.prepare(
        "SELECT status FROM ezadmin_export_batch WHERE id = ?"
      ).get(ezResult.batchId)
      R.batchCancelAvailable = batchRow?.status === 'ACTIVE'
      info(`배치 상태: ${batchRow?.status}  취소 가능: ${R.batchCancelAvailable ? 'YES' : 'NO'}`)
    }
  } catch (e) {
    warn(`이지어드민 파일 생성 오류: ${e.message}`)
    console.error(e.stack)
  }

  // ── 보고 ─────────────────────────────────────────────────────────
  printReport(R)
}

function printReport(r) {
  const row = (no, label, value, ok) => {
    const mark = ok === undefined ? '  ' : ok ? C.green(' ✓') : C.red(' ✗')
    const val  = value === '' ? C.gray('(없음)') : C.cyan(String(value))
    console.log(`${mark}  ${C.bold(String(no).padStart(2) + '.')} ${label.padEnd(34)} ${val}`)
  }

  console.log('\n' + C.bold('═══════════════════════════════════════════════════════'))
  console.log(C.bold('  테스트 보고 26항목 — 투에버 실접속 플로우'))
  console.log(C.bold(`  날짜: ${r.queryDate}`))
  console.log(C.bold('═══════════════════════════════════════════════════════'))
  console.log()

  row( 1, 'basePath',                          r.basePath,              !!r.basePath)
  row( 2, '투에버 로그인 성공',                r.loginSuccess ? 'YES' : 'NO', r.loginSuccess)
  row( 3, '조회 날짜',                         r.queryDate,             !!r.queryDate)
  row( 4, '엑셀 원본 저장 전체 경로',          r.rawExcelPath,          !!r.rawExcelPath)
  row( 5, '엑셀 파일명 / 크기',                `${r.rawExcelName} / ${r.rawExcelSize.toLocaleString()} bytes`, r.rawExcelSize > 0)
  row( 6, 'file hash (SHA-256 앞 32자)',       r.fileHash.slice(0, 32) || '', !!r.fileHash)
  row( 7, '파싱 행 수',                        r.parsedRowCount,        r.parsedRowCount >= 0)
  row( 8, '고유 주문번호 수',                  r.uniqueOrderCount,      r.uniqueOrderCount >= 0)
  row( 9, '신규 출고 대상 수',                 r.newShipmentTargets,    r.newShipmentTargets >= 0)
  row(10, '중복 스킵 수',                      r.duplicateSkipped,      true)
  row(11, '수동검토 건수',                     r.manualReviewCount,     true)
  row(12, '첫 번째 발주번호 (p_order_no)',     r.firstOrderNo,          r.parsedRowCount === 0 || !!r.firstOrderNo)
  row(13, '마지막 발주번호 (p_order_noTo)',    r.lastOrderNo,           r.parsedRowCount === 0 || !!r.lastOrderNo)
  row(14, 'PDF 저장 여부',                     r.pdfSaved ? 'YES' : (r.parsedRowCount === 0 ? 'SKIPPED(0건)' : 'NO'), r.parsedRowCount === 0 ? undefined : r.pdfSaved)
  row(15, 'PDF 저장 전체 경로',                r.pdfPath,               r.parsedRowCount === 0 || !!r.pdfPath)
  row(16, 'PDF 파일명 / 크기',                 r.pdfName ? `${r.pdfName} / ${r.pdfSize.toLocaleString()} bytes` : '', !r.pdfName || r.pdfSize > 0)
  row(17, '이지어드민 파일 생성 여부',         r.ezadminFileCreated ? 'YES' : (r.newShipmentTargets === 0 ? 'SKIPPED(0건)' : 'NO'), r.newShipmentTargets === 0 ? undefined : r.ezadminFileCreated)
  row(18, '이지어드민 파일 전체 경로',         r.ezadminFilePath,       r.newShipmentTargets === 0 || !!r.ezadminFilePath)
  row(19, '이지어드민 파일 행 수',             r.ezadminRowCount,       true)
  row(20, '이지어드민 파일 헤더',              r.ezadminHeaders.join(' | '), r.newShipmentTargets === 0 || r.ezadminHeaders.length >= 8)
  row(21, '주문번호 string 보존',              r.orderNoStringOk ? 'OK' : 'NG', r.orderNoStringOk)
  row(22, '생성된 배치 ID',                    r.batchId ?? '(없음)',   r.newShipmentTargets === 0 || r.batchId != null)
  row(23, '배치 취소 가능',                    r.batchCancelAvailable ? 'YES (ACTIVE)' : (r.newShipmentTargets === 0 ? '(배치 없음)' : 'NO'), r.newShipmentTargets === 0 ? undefined : r.batchCancelAvailable)
  row(24, '이지어드민 자동화 미실행',          'OK (자동 로그인/업로드 없음)',  true)
  row(25, '투에버 송장 업로드 미실행',         'OK (uploadBtn 클릭 없음)', true)
  row(26, '출고작업지시 미실행',               'OK (체크박스/submit 없음)', true)

  console.log('\n' + C.bold('═══════════════════════════════════════════════════════\n'))
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(C.red('\n[FATAL] ' + err.message))
    console.error(err.stack)
    process.exit(1)
  })
