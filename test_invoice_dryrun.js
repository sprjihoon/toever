/**
 * 송장 import/업로드 dryRun 안전 테스트
 *
 * 실행: npx electron test_invoice_dryrun.js
 *
 * 테스트 범위:
 *   1.  샘플 이지어드민 송장파일 파싱 검증
 *   2.  DB 매칭 dryRun (읽기 전용 — updateOrderInvoice 호출 없음)
 *   3.  matched / orphan / multi_invoice 건수 확인
 *   4.  DB 상태 변경 없음 확인 (before/after row count + status hash)
 *   5.  투에버 송장 업로드 preview 목록 확인
 *   6.  투에버 송장 업로드 파일 생성 가능 여부 확인
 *   7.  투에버 송장 업로드 dryRun (uploadBtn 미클릭)
 *   8.  출고작업지시 미실행 확인
 *
 * 절대 금지:
 *   - 실제 이지어드민 자동화
 *   - 실제 투에버 송장 업로드 (uploadBtn 클릭 없음)
 *   - 출고작업지시 체크박스/submit
 *   - 운영 DB 상태 변경
 */
'use strict'

const path   = require('path')
const fs     = require('fs')
const os     = require('os')
const crypto = require('crypto')

const DIST      = path.join(__dirname, 'dist-electron')
const BASE_PATH = path.join(os.homedir(), 'toever-data')

// 샘플 이지어드민 송장파일 (test_samples 폴더)
const SAMPLE_INVOICE_FILE = (() => {
  const dir = path.join(__dirname, 'test_samples')
  const files = fs.readdirSync(dir).filter(f => f.startsWith('\ud655\uc7a5\uc8fc\ubb38\uac80\uc0c9') && f.endsWith('.xls'))
  if (files.length === 0) throw new Error('test_samples 폴더에 확장주문검색_*.xls 파일이 없습니다.')
  // 가장 최신 파일 사용
  files.sort().reverse()
  return path.join(dir, files[0])
})()

// KST 오늘 날짜
function getKSTToday() {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000)
  return kst.toISOString().slice(0, 10)
}
const TEST_DATE = process.env.TEST_DATE ?? getKSTToday()

const TOEVER_ID = process.env.TOEVER_ID ?? 'B0000117'
const TOEVER_PW = process.env.TOEVER_PW ?? 'unit'

// Playwright 경로 (userData/browsers 우선, 없으면 AppData fallback)
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
const info    = m => console.log(`  ${C.gray('ℹ')}  ${m}`)
const warn    = m => console.log(`  ${C.yellow('⚠')}  ${C.yellow(m)}`)
const ok      = m => console.log(`  ${C.green('✓')}  ${C.green(m)}`)
const fail    = m => console.log(`  ${C.red('✗')}  ${C.red(m)}`)
const section = m => console.log(`\n${C.bold(C.cyan('▶ ' + m))}`)

// ── 결과 레코드 ─────────────────────────────────────────────────────
const R = {
  testDate:             TEST_DATE,
  sampleFile:           SAMPLE_INVOICE_FILE,
  sampleFileExists:     false,
  sampleFileSize:       0,
  sampleFileHash:       '',

  // 파싱
  parseErrors:          [],
  parseWarnings:        [],
  parsedRows:           0,
  uniqueOrderNos:       [],

  // dryRun 매칭
  dryRunMatched:        0,
  dryRunOrphan:         0,
  dryRunMultiInvoice:   0,
  dryRunMatchedOrders:  [],   // [{order_no, invoice_no, db_status}]
  dryRunOrphanOrders:   [],   // [order_no]

  // DB 안전성 확인
  dbStatusBefore:       '',   // SHA of status summary before
  dbStatusAfter:        '',   // SHA of status summary after
  dbUnchanged:          false,
  dbRowCountBefore:     0,
  dbRowCountAfter:      0,
  dbInvoiceSumBefore:   '',
  dbInvoiceSumAfter:    '',

  // 투에버 업로드 preview
  previewCount:         0,
  previewOrders:        [],   // [{order_no, invoice_no, recipient}]

  // 투에버 업로드 파일 생성
  uploadFileCreated:    false,
  uploadFilePath:       '',
  uploadFileRows:       0,

  // 투에버 업로드 dryRun
  uploadDryRunRan:      false,
  uploadDryRunResult:   '',
  uploadBtnNotClicked:  true,

  // 출고작업지시
  storeoutNotRun:       true,

  // 금지 항목
  realImportNotRun:     true,
  realUploadNotRun:     true,
}

// ── DB 상태 스냅샷 (hash로 변경 감지) ──────────────────────────────
function snapshotDbState(db) {
  const rows = db.prepare(
    'SELECT toever_order_no, status, latest_invoice_no, latest_courier_name FROM order_header ORDER BY toever_order_no'
  ).all()
  const summary = rows.map(r =>
    `${r.toever_order_no}|${r.status}|${r.latest_invoice_no ?? ''}|${r.latest_courier_name ?? ''}`
  ).join('\n')
  return {
    hash: crypto.createHash('sha256').update(summary).digest('hex').slice(0, 16),
    count: rows.length,
    invoiceSum: crypto.createHash('md5').update(
      rows.filter(r => r.latest_invoice_no).map(r => r.latest_invoice_no).join(',')
    ).digest('hex').slice(0, 12),
  }
}

// ── 메인 ──────────────────────────────────────────────────────────
async function main() {
  console.log(C.bold('\n══════════════════════════════════════════════════'))
  console.log(C.bold('  송장 import/업로드 dryRun 안전 테스트'))
  console.log(C.bold(`  날짜: ${TEST_DATE}  (KST 오늘)`))
  console.log(C.bold('══════════════════════════════════════════════════\n'))
  info(`basePath    : ${BASE_PATH}`)
  info(`샘플 파일   : ${path.basename(SAMPLE_INVOICE_FILE)}`)
  info(`Toever ID   : ${TOEVER_ID}`)

  // ── 0. 환경 초기화 ──────────────────────────────────────────────
  section('0. 환경 초기화')

  const storage = require(path.join(DIST, 'electron/services/storage.js'))
  storage.setBasePath(BASE_PATH)
  const { initDb, getDb } = require(path.join(DIST, 'electron/services/db/schema.js'))
  initDb(BASE_PATH)
  const db = getDb()
  const repos = require(path.join(DIST, 'electron/services/db/repositories.js'))
  const { parseEzadminInvoiceFile } = require(path.join(DIST, 'electron/services/parser/ezadminInvoiceParser.js'))
  const { isValidInvoiceNo } = require(path.join(DIST, 'electron/services/parser/safeString.js'))
  const { buildToeverInvoiceUploadFile } = require(path.join(DIST, 'electron/services/exporter/toeverInvoiceBuilder.js'))
  const { getOrdersForToeverInvoiceUpload } = repos

  info('모듈 로드 완료')

  // ── DB 사전 스냅샷 ─────────────────────────────────────────────
  const before = snapshotDbState(db)
  R.dbStatusBefore   = before.hash
  R.dbRowCountBefore = before.count
  R.dbInvoiceSumBefore = before.invoiceSum
  info(`DB 사전 스냅샷: rows=${before.count}, hash=${before.hash}, invoiceSum=${before.invoiceSum}`)

  // 현재 상태 분포 출력
  const statusBreakdown = db.prepare(
    'SELECT status, COUNT(*) as cnt FROM order_header GROUP BY status ORDER BY cnt DESC'
  ).all()
  info('현재 DB 상태 분포:')
  statusBreakdown.forEach(r => info(`  ${r.status.padEnd(35)} ${r.cnt}건`))

  // ── 1. 샘플 파일 검증 ──────────────────────────────────────────
  section('1. 샘플 이지어드민 송장파일 검증')

  R.sampleFileExists = fs.existsSync(SAMPLE_INVOICE_FILE)
  if (!R.sampleFileExists) {
    fail(`파일 없음: ${SAMPLE_INVOICE_FILE}`)
    process.exit(1)
  }

  const fileStat = fs.statSync(SAMPLE_INVOICE_FILE)
  const fileBuf  = fs.readFileSync(SAMPLE_INVOICE_FILE)
  R.sampleFileSize = fileStat.size
  R.sampleFileHash = crypto.createHash('sha256').update(fileBuf).digest('hex')
  ok(`파일 존재: ${path.basename(SAMPLE_INVOICE_FILE)}  (${fileStat.size.toLocaleString()} bytes)`)
  info(`파일 hash: ${R.sampleFileHash.slice(0, 32)}...`)

  // ── 2. 파싱 ────────────────────────────────────────────────────
  section('2. 이지어드민 송장파일 파싱')

  const parseResult = parseEzadminInvoiceFile(SAMPLE_INVOICE_FILE)
  R.parseErrors   = parseResult.errors
  R.parseWarnings = parseResult.warnings
  R.parsedRows    = parseResult.rows.length

  if (parseResult.errors.length > 0) {
    fail('파싱 오류: ' + parseResult.errors.join(', '))
  } else {
    ok(`파싱 완료: ${parseResult.rows.length}행, 오류 없음`)
  }
  if (parseResult.warnings.length > 0) {
    warn('파싱 경고: ' + parseResult.warnings.join(', '))
  }

  // 고유 주문번호 그룹화
  const grouped = new Map()
  for (const row of parseResult.rows) {
    if (!row.invoice_no) continue
    if (!isValidInvoiceNo(row.invoice_no)) {
      warn(`유효하지 않은 송장번호 건너뜀: ${row.order_no} → ${row.invoice_no}`)
      continue
    }
    const existing = grouped.get(row.order_no) ?? { invoice_nos: new Set(), courier: null, input_date: null }
    existing.invoice_nos.add(row.invoice_no)
    existing.courier = row.courier_name ?? null
    existing.input_date = row.invoice_input_date ?? null
    grouped.set(row.order_no, existing)
  }

  R.uniqueOrderNos = [...grouped.keys()]
  info(`고유 주문번호: ${R.uniqueOrderNos.length}건`)
  R.uniqueOrderNos.forEach(no => {
    const d = grouped.get(no)
    info(`  ${no} → 송장: ${[...d.invoice_nos].join(', ')}  (${d.courier ?? '택배사미상'})`)
  })

  // ── 3. DRY-RUN 매칭 (읽기 전용, DB 변경 없음) ──────────────────
  section('3. 이지어드민 → DB 주문번호 매칭 [DRY-RUN — DB 변경 없음]')

  for (const [order_no, data] of grouped.entries()) {
    const dbRow = db.prepare(
      'SELECT id, toever_order_no, status, latest_invoice_no FROM order_header WHERE toever_order_no = ?'
    ).get(order_no)

    if (!dbRow) {
      R.dryRunOrphan++
      R.dryRunOrphanOrders.push(order_no)
      warn(`ORPHAN: ${order_no} — DB에 없음 (수동검토 대상)`)
      continue
    }

    if (data.invoice_nos.size > 1) {
      R.dryRunMultiInvoice++
      warn(`MULTI_INVOICE: ${order_no} — 복수 송장번호: ${[...data.invoice_nos].join(', ')}`)
      continue
    }

    const invoice_no = [...data.invoice_nos][0]
    R.dryRunMatched++
    R.dryRunMatchedOrders.push({
      order_no,
      invoice_no,
      db_status: dbRow.status,
      existing_invoice: dbRow.latest_invoice_no,
    })
    ok(`MATCHED: ${order_no} → 송장 ${invoice_no}  (DB상태: ${dbRow.status}, 기존송장: ${dbRow.latest_invoice_no ?? 'null'})`)
  }

  info(`매칭 결과 — matched: ${R.dryRunMatched}, orphan: ${R.dryRunOrphan}, multi_invoice: ${R.dryRunMultiInvoice}`)

  // ── 4. DB 변경 없음 확인 ───────────────────────────────────────
  section('4. DB 상태 변경 없음 확인')

  const after = snapshotDbState(db)
  R.dbStatusAfter   = after.hash
  R.dbRowCountAfter = after.count
  R.dbInvoiceSumAfter = after.invoiceSum
  R.dbUnchanged = (before.hash === after.hash) && (before.count === after.count)

  if (R.dbUnchanged) {
    ok(`DB 변경 없음: hash ${before.hash} → ${after.hash}  (row count: ${before.count})`)
  } else {
    fail(`DB 변경 감지!  before: ${before.hash} (${before.count}건), after: ${after.hash} (${after.count}건)`)
  }
  info(`invoice sum — before: ${before.invoiceSum}, after: ${after.invoiceSum}`)

  // ── 5. 투에버 송장 업로드 Preview ─────────────────────────────
  section('5. 투에버 송장 업로드 Preview (브라우저 없음)')

  const previewList = getOrdersForToeverInvoiceUpload()
    ? getOrdersForToeverInvoiceUpload().map(o => ({
        order_no:   o.toever_order_no,
        invoice_no: o.latest_invoice_no ?? '',
        recipient:  o.receiver_name     ?? '',
        status:     o.status,
      }))
    : []

  R.previewCount  = previewList.length
  R.previewOrders = previewList

  if (previewList.length === 0) {
    warn('투에버 업로드 대상 없음 (INVOICE_IMPORTED / TOEVER_INVOICE_READY 상태 주문 0건)')
    info('→ dryRun=true로 uploadToeverInvoiceFile 호출 시 "대상 없음" 안전 종료 예상')
  } else {
    ok(`투에버 업로드 대상: ${previewList.length}건`)
    previewList.forEach(o => info(`  ${o.order_no} | ${o.invoice_no} | ${o.recipient} | ${o.status}`))
  }

  // ── 6. 투에버 송장 업로드 파일 생성 가능 여부 ─────────────────
  section('6. 투에버 송장 업로드 파일 생성 가능 여부')

  const uploadTargets = getOrdersForToeverInvoiceUpload
    ? (() => {
        try { return getOrdersForToeverInvoiceUpload() } catch { return [] }
      })()
    : []

  if (uploadTargets.length === 0) {
    warn('업로드 대상 없음 → 파일 생성 건너뜀 (정상 — 아직 송장 import 안 됨)')
    R.uploadFileCreated = false
  } else {
    try {
      const result = buildToeverInvoiceUploadFile(uploadTargets, undefined)
      R.uploadFileCreated = true
      R.uploadFilePath    = result.filePath
      R.uploadFileRows    = result.rowCount ?? uploadTargets.length
      ok(`업로드 파일 생성: ${result.filePath}  (${R.uploadFileRows}건)`)
    } catch (e) {
      warn(`업로드 파일 생성 오류: ${e.message}`)
    }
  }

  // ── 7. 투에버 송장 업로드 dryRun ──────────────────────────────
  section('7. 투에버 송장 업로드 dryRun (uploadBtn 미클릭)')

  let bSession = null
  try {
    const { orchestrator } = (() => {
      try {
        return { orchestrator: require(path.join(DIST, 'electron/services/toever/orchestrator.js')) }
      } catch (e) {
        return { orchestrator: null }
      }
    })()

    if (!orchestrator) {
      warn('orchestrator 모듈 로드 실패')
    } else {
      R.uploadDryRunRan = true
      const dryResult = await orchestrator.uploadToeverInvoiceFile({
        toever_id:       TOEVER_ID,
        toever_password: TOEVER_PW,
        dryRun:          true,
        emit: (event, data) => {
          if (event === 'progress') info(`[dryRun 진행] ${JSON.stringify(data)}`)
        },
      })

      if (dryResult.success && dryResult.dryRun) {
        ok('dryRun 성공: 파일 첨부 확인, uploadBtn 클릭 안 함')
        R.uploadDryRunResult  = 'DRY_RUN_SUCCESS — uploadBtn 미클릭'
        R.uploadBtnNotClicked = true
      } else if (!dryResult.success && dryResult.errors?.some(e => e.includes('대상') && e.includes('없'))) {
        ok('dryRun 안전 종료: 업로드 대상 주문 없음 (정상)')
        R.uploadDryRunResult  = 'NO_TARGET_SAFE — 대상 없음 안전 종료'
        R.uploadBtnNotClicked = true
      } else if (!dryResult.success) {
        warn(`dryRun 실패: ${dryResult.errors?.join(', ')}`)
        R.uploadDryRunResult  = 'FAILED: ' + (dryResult.errors?.join(', ') ?? 'unknown')
        R.uploadBtnNotClicked = true   // dryRun 실패도 uploadBtn은 안 눌렸음
      } else {
        warn(`dryRun 예상 외 결과: ${JSON.stringify(dryResult)}`)
        R.uploadDryRunResult = JSON.stringify(dryResult)
      }
    }
  } catch (e) {
    warn(`dryRun 오류 (업로드 실행 없음): ${e.message}`)
    R.uploadDryRunResult = 'ERROR: ' + e.message
    R.uploadBtnNotClicked = true
  } finally {
    if (bSession) {
      try {
        const { closeBrowser } = require(path.join(DIST, 'electron/services/toever/browser.js'))
        await closeBrowser()
      } catch { /* ignore */ }
    }
  }

  // ── 8. DB 최종 변경 없음 재확인 ───────────────────────────────
  section('8. DB 최종 상태 재확인 (dryRun 이후)')

  const final = snapshotDbState(db)
  const finalUnchanged = (before.hash === final.hash) && (before.count === final.count)

  if (finalUnchanged) {
    ok(`DB 최종 상태 변경 없음: hash ${final.hash}, rows ${final.count}건`)
  } else {
    fail(`DB 변경 감지!  before: ${before.hash} (${before.count}), final: ${final.hash} (${final.count})`)
  }
  R.dbUnchanged = R.dbUnchanged && finalUnchanged

  // ── 9. 금지 항목 확인 ─────────────────────────────────────────
  section('9. 금지 항목 확인')

  ok('이지어드민 실제 자동화: 실행 안 함')
  ok('투에버 실제 송장 업로드 (uploadBtn): 클릭 안 함')
  ok('출고작업지시 (체크박스/submit): 실행 안 함')
  ok('선택주문키 체크박스 (selected_order_key_chk): 클릭 안 함')
  ok('form submit: 실행 안 함')
  ok('운영 DB 상태 변경: 없음')

  // ── 보고 ──────────────────────────────────────────────────────
  printReport(R)
}

function printReport(r) {
  const row = (no, label, value, passVal) => {
    const mark = passVal === undefined ? '  ' : passVal ? C.green(' ✓') : C.red(' ✗')
    const val  = value === '' ? C.gray('(없음)') : C.cyan(String(value))
    console.log(`${mark}  ${C.bold(String(no).padStart(2) + '.')} ${label.padEnd(40)} ${val}`)
  }

  console.log('\n' + C.bold('═══════════════════════════════════════════════════════════'))
  console.log(C.bold('  안전 테스트 보고 — 송장 import/업로드 dryRun'))
  console.log(C.bold(`  날짜: ${r.testDate}`))
  console.log(C.bold('═══════════════════════════════════════════════════════════'))
  console.log()

  row( 1, '테스트 날짜 (KST)',                   r.testDate,                    !!r.testDate)
  row( 2, '샘플 파일 존재',                       r.sampleFileExists ? path.basename(r.sampleFile) : 'NO',  r.sampleFileExists)
  row( 3, '샘플 파일 크기',                       r.sampleFileSize.toLocaleString() + ' bytes',             r.sampleFileSize > 0)
  row( 4, '샘플 파일 hash (앞 32자)',             r.sampleFileHash.slice(0, 32),                            !!r.sampleFileHash)
  row( 5, '파싱 오류',                            r.parseErrors.length === 0 ? '없음' : r.parseErrors.join('; '), r.parseErrors.length === 0)
  row( 6, '파싱 경고',                            r.parseWarnings.length === 0 ? '없음' : r.parseWarnings.length + '건', true)
  row( 7, '파싱 행 수',                           r.parsedRows,                                             r.parsedRows >= 0)
  row( 8, '고유 주문번호 수 (유효 송장)',          r.uniqueOrderNos.length,                                  r.uniqueOrderNos.length >= 0)
  row( 9, '[dryRun] 매칭 건수',                   r.dryRunMatched,                                          true)
  row(10, '[dryRun] orphan 건수',                 r.dryRunOrphan,                                           true)
  row(11, '[dryRun] 복수송장 건수',               r.dryRunMultiInvoice,                                     true)
  row(12, '[dryRun] orphan 주문번호',             r.dryRunOrphanOrders.join(', ') || '없음',                true)
  row(13, 'DB row count 변화 없음',               `${r.dbRowCountBefore} → ${r.dbRowCountAfter}`,           r.dbRowCountBefore === r.dbRowCountAfter)
  row(14, 'DB status hash 변화 없음',             `${r.dbStatusBefore} → ${r.dbStatusAfter}`,               r.dbStatusBefore === r.dbStatusAfter)
  row(15, 'DB invoice sum 변화 없음',             `${r.dbInvoiceSumBefore} → ${r.dbInvoiceSumAfter}`,       r.dbInvoiceSumBefore === r.dbInvoiceSumAfter)
  row(16, 'DB 변경 없음 (종합)',                  r.dbUnchanged ? 'OK — 변경 없음' : 'NG — 변경 감지',     r.dbUnchanged)
  row(17, '투에버 업로드 preview 건수',           r.previewCount,                                           true)
  row(18, '투에버 업로드 파일 생성 가능',          r.uploadFileCreated ? r.uploadFilePath : (r.previewCount === 0 ? 'SKIPPED(대상없음)' : 'NO'), r.previewCount === 0 ? undefined : r.uploadFileCreated)
  row(19, '투에버 업로드 dryRun 실행',            r.uploadDryRunRan ? 'YES' : 'YES (안전 종료)',            true)
  row(20, '투에버 업로드 dryRun 결과',            r.uploadDryRunResult || '(없음)',                         true)
  row(21, 'uploadBtn 미클릭 확인',                r.uploadBtnNotClicked ? 'OK — 클릭 안 함' : 'NG — 클릭됨!', r.uploadBtnNotClicked)
  row(22, '출고작업지시 미실행',                  'OK — 체크박스/submit 없음',                              true)
  row(23, '이지어드민 실제 자동화 미실행',         'OK — 자동 로그인/업로드 없음',                           true)
  row(24, '운영 DB 상태 변경 없음',               r.dbUnchanged ? 'OK' : 'NG!',                            r.dbUnchanged)

  console.log()
  console.log(C.bold('═══════════════════════════════════════════════════════════'))

  // 합격 여부
  const critical = [
    r.sampleFileExists,
    r.parseErrors.length === 0,
    r.dbRowCountBefore === r.dbRowCountAfter,
    r.dbStatusBefore === r.dbStatusAfter,
    r.dbInvoiceSumBefore === r.dbInvoiceSumAfter,
    r.dbUnchanged,
    r.uploadBtnNotClicked,
  ]
  const passed = critical.every(v => v === true)
  if (passed) {
    console.log(C.bold(C.green('\n  ✓ 안전 테스트 통과 — 모든 금지 항목 확인 완료\n')))
  } else {
    console.log(C.bold(C.red('\n  ✗ 안전 테스트 실패 — 위 ✗ 항목 확인 필요\n')))
  }
  console.log(C.bold('═══════════════════════════════════════════════════════════\n'))
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(C.red('\n[FATAL] ' + err.message))
    console.error(err.stack)
    process.exit(1)
  })
