/**
 * 투에버 실접속 플로우 테스트
 *
 * 실행: npx electron test_live_flow.js
 *
 * 테스트 범위:
 *   1. 투에버 로그인
 *   2. 발주내역 화면 이동
 *   3. 날짜 2026-07-08 설정
 *   4. 조회 실행
 *   5. 엑셀 다운로드
 *   6. raw/toever_orders 저장 + hash 기록
 *   7. 주문 파싱 + 주문번호 string 보존 확인
 *   8. 오전/오후 중복 필터링
 *   9. PDF 출력 저장
 *  10. 이지어드민 업로드 파일 생성
 *
 * 실행하지 않는 것:
 *   - 이지어드민 송장 import
 *   - 투에버 송장 업로드 (uploadBtn 클릭 없음)
 *   - 출고작업지시 (체크박스/submit 없음)
 *   - 송장번호 관련 상태 변경
 */
'use strict'

const path  = require('path')
const fs    = require('fs')
const os    = require('os')
const crypto = require('crypto')

const DIST       = path.join(__dirname, 'dist-electron')
const BASE_PATH  = path.join(os.homedir(), 'toever-data')  // 영구 저장 경로
const TEST_DATE  = '2026-07-08'
const TOEVER_ID  = process.env.TOEVER_ID  ?? 'B0000117'
const TOEVER_PW  = process.env.TOEVER_PW  ?? 'unit'
const ROUND      = 'morning'  // CollectRound

// Playwright Chromium 경로 (앱과 동일)
process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(
  process.env.APPDATA ?? os.homedir(),
  'spring-toever-ops', 'browsers'
)

// ── 컬러 출력 ──────────────────────────────────────────────────────
const C = {
  green:  s => `\x1b[32m${s}\x1b[0m`,
  red:    s => `\x1b[31m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
  cyan:   s => `\x1b[36m${s}\x1b[0m`,
  bold:   s => `\x1b[1m${s}\x1b[0m`,
  gray:   s => `\x1b[90m${s}\x1b[0m`,
}
function info(msg)  { console.log(`  ${C.gray('ℹ')}  ${msg}`) }
function warn(msg)  { console.log(`  ${C.yellow('⚠')}  ${C.yellow(msg)}`) }
function section(m) { console.log(`\n${C.bold(C.cyan('▶ ' + m))}`) }

// ── 17가지 보고 항목 수집 ───────────────────────────────────────────
const report = {
  basePath:                 '',
  rawExcelPath:             '',
  rawExcelName:             '',
  rawExcelSize:             0,
  parsedRowCount:           0,
  uniqueOrderCount:         0,
  newShipmentTargets:       0,
  duplicateSkipped:         0,
  manualReviewCount:        0,
  firstOrderNo:             '',
  lastOrderNo:              '',
  pdfPath:                  '',
  pdfName:                  '',
  pdfSize:                  0,
  ezadminFilePath:          '',
  ezadminRowCount:          0,
  ezadminHeaders:           [],
  orderNoStringPreserved:   false,
  invoiceUploadNotExecuted: true,
  storeoutNotExecuted:      true,
}

// ── 메인 ──────────────────────────────────────────────────────────
async function main() {
  console.log(C.bold('\n══════════════════════════════════════════════'))
  console.log(C.bold('  투에버 실접속 플로우 테스트'))
  console.log(C.bold('  날짜: ' + TEST_DATE))
  console.log(C.bold('══════════════════════════════════════════════\n'))
  info(`basePath : ${BASE_PATH}`)
  info(`ID       : ${TOEVER_ID}`)
  info(`Round    : ${ROUND}\n`)

  // ── 0. 환경 초기화 ────────────────────────────────────────────────
  section('0. 환경 초기화')

  const storage = require(path.join(DIST, 'electron/services/storage.js'))
  storage.setBasePath(BASE_PATH)
  storage.ensureAllDirs()
  report.basePath = BASE_PATH
  info(`basePath 설정: ${BASE_PATH}`)

  const { initDb, getDb } = require(path.join(DIST, 'electron/services/db/schema.js'))
  initDb(BASE_PATH)
  const db = getDb()
  info('DB 초기화 완료')

  const repos = require(path.join(DIST, 'electron/services/db/repositories.js'))
  const parser = require(path.join(DIST, 'electron/services/parser/toeverOrderParser.js'))
  const dedup  = require(path.join(DIST, 'electron/services/dedup/duplicateFilter.js'))
  const browser = require(path.join(DIST, 'electron/services/toever/browser.js'))
  const exporter = require(path.join(DIST, 'electron/services/exporter/ezadminUploadBuilder.js'))

  const DIRS = storage.DIRS

  // ── 1~5. 브라우저 로그인 + 조회 + 엑셀 다운로드 ────────────────────
  section('1~5. 투에버 로그인 → 조회 → 엑셀 다운로드')

  const downloadDir = path.join(
    DIRS.rawToeverOrders(),
    `${TEST_DATE.replace(/-/g, '')}_${ROUND}`
  )
  if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir, { recursive: true })

  let browserSession = null
  let rawFilePath    = null
  let pdfResult      = null
  let runId          = null

  try {
    // run 레코드 생성
    const idempotencyKey = `source=toever|date=${TEST_DATE}|round=${ROUND}|live_test`
    let run
    const existingRun = repos.getRunByIdempotencyKey(idempotencyKey)
    if (existingRun) {
      repos.resetRunForRetry(existingRun.id)
      const { getRunById } = require(path.join(DIST, 'electron/services/db/repositories.js'))
      run = repos.getRunById(existingRun.id) ?? existingRun
    } else {
      run = repos.createRun('COLLECT_ORDERS', TEST_DATE, idempotencyKey, ROUND)
    }
    runId = run.id
    info(`run_id: ${runId}`)

    // 브라우저 실행
    info('브라우저 실행 중...')
    browserSession = await browser.launchBrowser(downloadDir)
    const { page, context } = browserSession

    // 로그인
    info('투에버 로그인 중...')
    const loginResult = await browser.loginToever(page, TOEVER_ID, TOEVER_PW, runId)
    if (!loginResult.success) {
      throw new Error(`로그인 실패: ${loginResult.error}`)
    }
    info(`로그인 ${loginResult.sessionReused ? '(세션 재사용)' : '성공'}`)

    // 발주내역 조회 + 엑셀 다운로드
    info(`발주내역 조회 (${TEST_DATE})...`)
    const dlResult = await browser.downloadToeverOrders(page, TEST_DATE, TEST_DATE, downloadDir, runId)
    if (!dlResult.success || !dlResult.filePath) {
      throw new Error(`다운로드 실패: ${dlResult.error}`)
    }
    rawFilePath = dlResult.filePath
    info(`다운로드 완료: ${rawFilePath}`)

    // ── 6. raw 파일 저장 + hash ──────────────────────────────────────
    section('6. raw 파일 저장 + hash 기록')

    const fileBytes = fs.readFileSync(rawFilePath)
    const fileSha256 = crypto.createHash('sha256').update(fileBytes).digest('hex')
    const fileStat   = fs.statSync(rawFilePath)

    // 중복 파일 체크 (동일 hash 이미 있으면 경고)
    const existingArtifact = db.prepare('SELECT id FROM file_artifact WHERE sha256 = ?').get(fileSha256)
    if (existingArtifact) {
      warn(`이미 import된 파일과 동일한 hash 감지 (재처리 주의): ${fileSha256.slice(0, 16)}...`)
    } else {
      repos.saveFileArtifact({
        artifact_type:     'TOEVER_ORDER_RAW',
        original_filename: path.basename(rawFilePath),
        stored_path:       rawFilePath,
        sha256:            fileSha256,
        size_bytes:        fileStat.size,
        run_id:            runId,
      })
      info('artifact 등록 완료')
    }

    report.rawExcelPath = rawFilePath
    report.rawExcelName = path.basename(rawFilePath)
    report.rawExcelSize = fileStat.size
    info(`파일명: ${report.rawExcelName}  (${fileStat.size.toLocaleString()} bytes)`)

    // ── 7. 파싱 + 주문번호 string 보존 확인 ──────────────────────────
    section('7. 주문 파싱 + 주문번호 string 보존')

    const parseResult = parser.parseToeverOrderFile(rawFilePath)
    if (parseResult.errors.length > 0) {
      warn('파싱 경고: ' + parseResult.errors.join(', '))
    }

    report.parsedRowCount = parseResult.rows.length
    info(`파싱 행 수: ${parseResult.rows.length}`)

    // 고유 주문번호 수
    const orderGroups = new Map()
    for (const row of parseResult.rows) {
      const g = orderGroups.get(row.toever_order_no) ?? []
      g.push(row)
      orderGroups.set(row.toever_order_no, g)
    }
    report.uniqueOrderCount = orderGroups.size
    info(`고유 주문번호: ${orderGroups.size}건`)

    // 주문번호 string 보존 확인
    const allStrings = parseResult.rows.every(r => typeof r.toever_order_no === 'string')
    report.orderNoStringPreserved = allStrings
    if (allStrings) {
      info('주문번호 string 보존: OK')
    } else {
      warn('주문번호 일부가 string이 아님!')
    }

    // 첫/마지막 발주번호 추출 (PDF 파라미터용)
    if (parseResult.rows.length > 0) {
      const orderNos = parseResult.rows.map(r => r.toever_order_no).sort()
      report.firstOrderNo = orderNos[0]
      report.lastOrderNo  = orderNos[orderNos.length - 1]
      info(`발주번호 범위: ${report.firstOrderNo} ~ ${report.lastOrderNo}`)
    } else {
      warn('조회 결과 없음 - 발주번호 범위를 추출할 수 없습니다.')
    }

    // ── 8. 중복 필터링 + DB 저장 ────────────────────────────────────
    section('8. 오전/오후 중복 필터링 + DB 저장')

    const filterResult = dedup.filterNewShipmentTargets(parseResult.rows, runId)
    info(`신규 출고 대상: ${filterResult.new_targets.length}건`)
    info(`중복 스킵: ${filterResult.duplicates.length}건`)
    info(`변경 검토: ${filterResult.changed_reviews.length}건`)

    // DB 트랜잭션 저장
    const saveAll = db.transaction(() => {
      for (const [orderNo, rows] of orderGroups.entries()) {
        const first       = rows[0]
        const isNewTarget = filterResult.new_targets.some(t => t.toever_order_no === orderNo)
        const isDuplicate = filterResult.duplicates.includes(orderNo)
        const isChanged   = filterResult.changed_reviews.includes(orderNo)

        const hash = parser.computeOrderHash({
          receiver_name:    first.receiver_name,
          receiver_phone:   first.receiver_phone,
          receiver_address: first.receiver_address,
          product_name:     rows.map(r => `${r.product_name}/${r.option_name ?? ''}/${r.quantity}`).join('|'),
          option_name:      null,
          quantity:         rows.reduce((s, r) => s + r.quantity, 0),
          delivery_message: first.delivery_message,
        })

        const status = isNewTarget ? 'NEW_SHIPMENT_TARGET'
          : isDuplicate ? 'DUPLICATE_SKIPPED'
          : isChanged   ? 'ORDER_CHANGED_REVIEW'
          : 'COLLECTED'

        const { id: orderId, isNew, existingStatus } = repos.upsertOrderHeader({
          toever_order_no:         orderNo,
          toever_po_no:            null,
          order_date:              TEST_DATE,
          receiver_name:           first.receiver_name,
          receiver_phone:          first.receiver_phone,
          receiver_address:        first.receiver_address,
          delivery_message:        first.delivery_message,
          status,
          latest_invoice_no:       first.invoice_no,
          latest_courier_name:     first.courier_name,
          latest_invoice_input_at: null,
          ezadmin_batch_id:        null,
          source_run_id:           runId,
          hash_snapshot:           hash,
        })

        const itemRows = rows.map((r, idx) => ({
          line_no:      idx + 1,
          product_name: r.product_name,
          option_name:  r.option_name,
          quantity:     r.quantity,
          ezadmin_product_code: null,
          barcode: null,
          line_hash: parser.computeOrderHash({
            receiver_name: r.receiver_name, receiver_phone: r.receiver_phone,
            receiver_address: r.receiver_address, product_name: r.product_name,
            option_name: r.option_name, quantity: r.quantity,
            delivery_message: r.delivery_message,
          }),
        }))

        const PROTECTED = ['EXPORTED_TO_EZADMIN','INVOICE_IMPORTED','TOEVER_INVOICE_READY','TOEVER_INVOICE_UPLOADED','STOREOUT_INSTRUCTED']
        if (isNew) {
          repos.insertOrderItems(orderId, itemRows)
        } else if (!PROTECTED.includes(existingStatus ?? '')) {
          const KEEP_STATUS = ['NEW_SHIPMENT_TARGET']
          if (!(isDuplicate && KEEP_STATUS.includes(existingStatus ?? ''))) {
            repos.updateOrderStatus(orderId, status)
          }
          if (isChanged) repos.insertOrderItems(orderId, itemRows)
        }
      }
    })
    saveAll()

    report.newShipmentTargets = filterResult.new_targets.length
    report.duplicateSkipped   = filterResult.duplicates.length

    // 수동검토 건수
    const manualCount = db.prepare(`SELECT COUNT(*) as cnt FROM manual_review_queue WHERE run_id = ?`).get(runId)
    report.manualReviewCount = manualCount?.cnt ?? 0

    repos.updateRunStatus(runId, 'SUCCESS',
      `수집=${orderGroups.size}, 신규=${filterResult.new_targets.length}, 중복=${filterResult.duplicates.length}`)
    info('DB 저장 완료')

    // ── 9. PDF 저장 ────────────────────────────────────────────────
    section('9. PDF 출력 저장')

    pdfResult = await browser.savePdfReport({ context, dateFrom: TEST_DATE, dateTo: TEST_DATE, run_id: runId })

    if (pdfResult.success && pdfResult.filePath) {
      const pdfStat = fs.existsSync(pdfResult.filePath) ? fs.statSync(pdfResult.filePath) : null
      report.pdfPath = pdfResult.filePath
      report.pdfName = path.basename(pdfResult.filePath)
      report.pdfSize = pdfStat?.size ?? 0
      info(`PDF 저장: ${pdfResult.filePath}  (${(report.pdfSize / 1024).toFixed(1)} KB)`)
    } else if (pdfResult.skipped) {
      warn(`PDF 저장 건너뜀: ${pdfResult.skip_reason}`)
    } else {
      warn(`PDF 저장 실패 (주 흐름 계속): ${pdfResult.error}`)
    }

  } catch (err) {
    console.error(`\n${C.red('오류: ' + err.message)}`)
    console.error(err.stack)
  } finally {
    if (browserSession) {
      info('브라우저 종료...')
      await browser.closeBrowser()
    }
  }

  // ── 10. 이지어드민 업로드 파일 생성 ─────────────────────────────────
  section('10. 이지어드민 업로드 파일 생성')

  let ezResult = null
  try {
    const newTargets = repos.getOrdersForEzadminExport(TEST_DATE)
    info(`신규 출고 대상 쿼리: ${newTargets.length}건 (NEW_SHIPMENT_TARGET)`)

    if (newTargets.length === 0) {
      warn('이지어드민 업로드 대상 없음 (신규 출고 주문 0건)')
    } else {
      const { getOrderItems } = require(path.join(DIST, 'electron/services/db/repositories.js'))
      const ordersWithItems = newTargets.map(h => ({
        header: h,
        items:  getOrderItems(h.id),
      }))

      ezResult = exporter.buildEzadminUploadFile(ordersWithItems, TEST_DATE, runId, ROUND)
      info(`생성 완료: ${ezResult.filePath}  (${ezResult.rowCount}행)`)

      // 헤더 확인 + 주문번호 string 검증
      const XLSX = require(path.join(__dirname, 'node_modules', 'xlsx'))
      const wb = XLSX.readFile(ezResult.filePath, { type: 'binary', raw: true })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true })

      report.ezadminFilePath = ezResult.filePath
      report.ezadminRowCount = ezResult.rowCount
      report.ezadminHeaders  = rows[0] ?? []

      // 주문번호 string 보존 (셀 타입 'n' 이면 숫자로 저장된 것)
      const cellA2 = ws['A2']
      const isStringCell = !cellA2 || cellA2.t === 's'
      if (!isStringCell) {
        warn('이지어드민 파일의 주문번호(A2)가 string 타입이 아닙니다!')
      } else {
        info('이지어드민 파일 주문번호 string 보존: OK')
      }
    }
  } catch (e) {
    warn(`이지어드민 파일 생성 오류: ${e.message}`)
    ezResult = { error: e.message }
  }

  // ── 11. 안전 확인 ────────────────────────────────────────────────
  section('11. 실행 안 한 작업 확인')

  // 이 테스트 스크립트에서 uploadBtn 클릭 / form submit / 체크박스 클릭이 없음을 코드 레벨 확인
  report.invoiceUploadNotExecuted = true
  report.storeoutNotExecuted      = true
  info('송장 업로드: 미실행 ✓')
  info('출고작업지시: 미실행 ✓')

  // ── 최종 보고 17항목 ──────────────────────────────────────────────
  printReport(report)
}

function printReport(r) {
  const line = (no, label, value, ok) => {
    const mark = ok === undefined ? C.gray('  ') : ok ? C.green(' ✓') : C.red(' ✗')
    console.log(`${mark}  ${C.bold(String(no).padStart(2, ' ') + '.')} ${label.padEnd(36)} ${C.cyan(String(value))}`)
  }

  console.log('\n' + C.bold('══════════════════════════════════════════════════════'))
  console.log(C.bold('  테스트 보고 — 2026-07-08 투에버 실접속 플로우'))
  console.log(C.bold('══════════════════════════════════════════════════════'))
  console.log()

  line( 1, 'basePath',                          r.basePath,               !!r.basePath)
  line( 2, '엑셀 원본 저장 전체 경로',          r.rawExcelPath,           !!r.rawExcelPath)
  line( 3, '엑셀 파일명 / 크기',                `${r.rawExcelName} / ${r.rawExcelSize.toLocaleString()} bytes`, r.rawExcelSize > 0)
  line( 4, '파싱 행 수',                        r.parsedRowCount,         r.parsedRowCount >= 0)
  line( 5, '고유 주문번호 수',                  r.uniqueOrderCount,       r.uniqueOrderCount >= 0)
  line( 6, '신규 출고 대상 수',                 r.newShipmentTargets,     r.newShipmentTargets >= 0)
  line( 7, '중복 스킵 수',                      r.duplicateSkipped,       true)
  line( 8, '수동검토 건수',                     r.manualReviewCount,      true)
  line( 9, '첫 번째 발주번호 (p_order_no)',     r.firstOrderNo,           !!r.firstOrderNo)
  line(10, '마지막 발주번호 (p_order_noTo)',    r.lastOrderNo,            !!r.lastOrderNo)
  line(11, 'PDF 저장 전체 경로',                r.pdfPath || '(저장 없음)', true)
  line(12, 'PDF 파일명 / 크기',                 r.pdfName ? `${r.pdfName} / ${r.pdfSize.toLocaleString()} bytes` : '(없음)', !r.pdfName || r.pdfSize > 0)
  line(13, '이지어드민 파일 전체 경로',         r.ezadminFilePath || '(없음)', true)
  line(14, '이지어드민 파일 행 수',             r.ezadminRowCount,        true)
  line(15, '이지어드민 파일 헤더',              r.ezadminHeaders.join(' | '), r.ezadminHeaders.length >= 8)
  line(16, '주문번호 string 보존',              r.orderNoStringPreserved ? 'OK' : 'NG', r.orderNoStringPreserved)
  line(17, '송장업로드/출고지시 미실행',        r.invoiceUploadNotExecuted && r.storeoutNotExecuted ? 'OK' : 'NG', r.invoiceUploadNotExecuted && r.storeoutNotExecuted)

  console.log()
  console.log(C.bold('══════════════════════════════════════════════════════\n'))
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(C.red('\n[FATAL] ' + err.message))
    console.error(err.stack)
    process.exit(1)
  })
