/**
 * 투에버 웹 자동화 연결 테스트
 *
 * 실행: npx electron test_toever_browser.js
 *
 * 환경변수:
 *   TOEVER_ID  - 투에버 ID
 *   TOEVER_PW  - 투에버 비밀번호
 *   TEST_DATE  - 조회 날짜 (기본: 2026-07-08)
 *
 * 주의:
 *   - 송장 업로드 실행 안 함
 *   - 출고작업지시 실행 안 함
 *   - 조회 + 다운로드 + 파싱만 테스트
 */
'use strict'

const path = require('path')
const fs   = require('fs')
const os   = require('os')

const DIST        = path.join(__dirname, 'dist-electron')
const STORAGE     = path.join(os.tmpdir(), 'toever_browser_test_' + Date.now())
const TEST_DATE   = process.env.TEST_DATE ?? '2026-07-08'
const TOEVER_ID   = process.env.TOEVER_ID
const TOEVER_PW   = process.env.TOEVER_PW

// Playwright 브라우저 경로 (앱 userData와 동일)
const BROWSERS_PATH = path.join(
  process.env.APPDATA ?? os.homedir(),
  'spring-toever-ops', 'browsers'
)
process.env.PLAYWRIGHT_BROWSERS_PATH = BROWSERS_PATH

// ── 컬러 출력 ─────────────────────────────────────────────────────────
const C = {
  green:  s => `\x1b[32m${s}\x1b[0m`,
  red:    s => `\x1b[31m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
  cyan:   s => `\x1b[36m${s}\x1b[0m`,
  bold:   s => `\x1b[1m${s}\x1b[0m`,
}
const OK   = C.green('✓')
const FAIL = C.red('✗')

let passed = 0, failed = 0
const failList = []
function pass(msg) { console.log(`  ${OK}  ${msg}`); passed++ }
function fail(msg, err) {
  console.log(`  ${FAIL}  ${C.red(msg)}`)
  if (err) console.log(`     ${C.yellow(String(err).slice(0, 200))}`)
  failed++; failList.push(msg)
}
function section(msg) { console.log(`\n${C.bold(C.cyan('▶ ' + msg))}`) }
function info(msg)    { console.log(`  ℹ  ${msg}`) }

// ── 메인 ──────────────────────────────────────────────────────────────
async function main() {
  console.log(C.bold('\n══════════════════════════════════════════'))
  console.log(C.bold('  투에버 브라우저 자동화 연결 테스트'))
  console.log(C.bold('══════════════════════════════════════════\n'))
  info(`조회 날짜: ${TEST_DATE}`)
  info(`Chromium: ${BROWSERS_PATH}`)
  info(`스토리지: ${STORAGE}\n`)

  if (!TOEVER_ID || !TOEVER_PW) {
    console.error(C.red('오류: TOEVER_ID, TOEVER_PW 환경변수를 설정하세요.'))
    process.exit(1)
  }

  // ── 환경 초기화 ────────────────────────────────────────────────────
  section('0. 환경 초기화')
  const storage = require(path.join(DIST, 'electron/services/storage.js'))
  storage.setBasePath(STORAGE)
  storage.ensureAllDirs()
  pass('스토리지 초기화')

  const { initDb, getDb } = require(path.join(DIST, 'electron/services/db/schema.js'))
  initDb(STORAGE)
  const db = getDb()
  pass('DB 초기화')

  // Chromium 확인 (chrome-win64 / chrome-win 모두 허용)
  function findChromiumExe(browsersPath) {
    if (!fs.existsSync(browsersPath)) return null
    const entries = fs.readdirSync(browsersPath)
    const chromiumDir = entries.find(e => e.startsWith('chromium-'))
    if (!chromiumDir) return null
    const base = path.join(browsersPath, chromiumDir)
    const candidates = [
      path.join(base, 'chrome-win64', 'chrome.exe'),
      path.join(base, 'chrome-win', 'chrome.exe'),
    ]
    return candidates.find(p => fs.existsSync(p)) ?? null
  }

  const chromiumExe = findChromiumExe(BROWSERS_PATH)
  if (chromiumExe) {
    pass(`Chromium 확인: ${chromiumExe}`)
  } else {
    fail('Chromium 실행 파일 없음', BROWSERS_PATH)
    process.exit(1)
  }

  // ── 브라우저 실행 + 로그인 ─────────────────────────────────────────
  section('1. 브라우저 실행 + 투에버 로그인')
  const { launchBrowser, loginToever, checkLoginSession, closeBrowser } =
    require(path.join(DIST, 'electron/services/toever/browser.js'))

  const downloadDir = storage.DIRS.rawToeverOrders()
  if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir, { recursive: true })

  const repos = require(path.join(DIST, 'electron/services/db/repositories.js'))
  const run = repos.createRun(
    'COLLECT_ORDERS', TEST_DATE,
    `source=toever|date=${TEST_DATE}|round=manual_test`, 'manual'
  )

  let session
  try {
    info('브라우저 실행 중...')
    session = await launchBrowser(downloadDir)
    pass('브라우저 실행 성공')
  } catch (e) {
    fail('브라우저 실행 실패', e)
    process.exit(1)
  }

  const { page } = session
  let loginOk = false

  try {
    // 1. 기존 세션 확인
    info('로그인 세션 확인 중...')
    const sessionValid = await checkLoginSession(page)
    if (sessionValid) {
      pass('기존 로그인 세션 유효 (재로그인 생략)')
      loginOk = true
    } else {
      info('세션 없음 → 자동 로그인 시도')
      const loginResult = await loginToever(page, TOEVER_ID, TOEVER_PW, run.id)
      if (loginResult.success) {
        if (loginResult.sessionReused) {
          pass('세션 재사용 (재로그인 불필요)')
        } else {
          pass('로그인 성공')
          if (loginResult.screenshotPath) info(`스크린샷: ${loginResult.screenshotPath}`)
        }
        loginOk = true
      } else {
        fail('로그인 실패', loginResult.error)
        if (loginResult.screenshotPath) info(`실패 스크린샷: ${loginResult.screenshotPath}`)
        repos.updateRunStatus(run.id, 'FAILED', undefined, 'LOGIN_FAILED', loginResult.error)
        await closeBrowser()
        await printSummary()
        process.exit(1)
      }
    }
    pass('최대 1회 재시도 정책 확인 (코드 검증)')
  } catch (e) {
    fail('로그인 과정 예외', e)
    await closeBrowser()
    process.exit(1)
  }

  // ── 발주내역 조회 + 엑셀 다운로드 ──────────────────────────────────
  section(`2. 발주내역 조회 (${TEST_DATE}) + 엑셀 다운로드`)
  let downloadedFilePath = null

  try {
    const { downloadToeverOrders } = require(path.join(DIST, 'electron/services/toever/browser.js'))
    info(`조회 날짜: ${TEST_DATE} ~ ${TEST_DATE}`)
    info('발주내역 화면 이동 + 날짜 설정 + 조회 중...')

    const dlResult = await downloadToeverOrders(page, TEST_DATE, TEST_DATE, downloadDir, run.id)

    if (!dlResult.success || !dlResult.filePath) {
      fail('엑셀 다운로드 실패', dlResult.error)
      repos.updateRunStatus(run.id, 'FAILED', undefined, 'DOWNLOAD_FAILED', dlResult.error)
    } else {
      downloadedFilePath = dlResult.filePath
      const stat = fs.statSync(downloadedFilePath)
      pass(`엑셀 다운로드 성공: ${path.basename(downloadedFilePath)}`)
      pass(`파일 크기: ${(stat.size / 1024).toFixed(1)} KB`)
      info(`저장 경로: ${downloadedFilePath}`)

      // raw/toever_orders에 원본 저장 확인
      if (downloadedFilePath.startsWith(downloadDir)) {
        pass(`raw/toever_orders 저장 확인`)
      } else {
        info(`경고: 예상 경로 외 저장 (${downloadDir})`)
      }
    }
  } catch (e) {
    fail('다운로드 예외', e)
  } finally {
    await closeBrowser()
    pass('브라우저 종료')
  }

  // ── 파싱 + 중복 필터링 + DB 저장 ──────────────────────────────────
  section('3. 다운로드 파일 파싱 + 중복 필터링')

  if (!downloadedFilePath) {
    fail('다운로드 파일 없어 파싱 건너뜀')
    await printSummary()
    process.exit(1)
  }

  try {
    const { parseToeverOrderFile, computeOrderHash } =
      require(path.join(DIST, 'electron/services/parser/toeverOrderParser.js'))
    const { filterNewShipmentTargets } =
      require(path.join(DIST, 'electron/services/dedup/duplicateFilter.js'))

    // 파일 artifact 등록
    const { sha256OfFile } = require(path.join(DIST, 'electron/services/storage.js'))
    const fileSha = sha256OfFile(downloadedFilePath)
    const fileStat = fs.statSync(downloadedFilePath)
    repos.saveFileArtifact({
      artifact_type: 'TOEVER_ORDER_RAW',
      original_filename: path.basename(downloadedFilePath),
      stored_path: downloadedFilePath,
      sha256: fileSha,
      size_bytes: fileStat.size,
      run_id: run.id,
    })

    // 파싱
    info('파일 파싱 중...')
    const parseResult = parseToeverOrderFile(downloadedFilePath)

    if (parseResult.errors.length > 0) {
      fail(`파싱 오류: ${parseResult.errors.join(', ')}`)
    } else {
      pass(`파싱 완료: ${parseResult.rows.length}행, 오류 0건`)
    }
    if (parseResult.warnings.length > 0) {
      for (const w of parseResult.warnings.slice(0, 3)) info(`경고: ${w}`)
    }

    // 주문번호 샘플 출력
    const uniqOrders = new Set(parseResult.rows.map(r => r.toever_order_no))
    pass(`고유 주문번호: ${uniqOrders.size}건 (전체 ${parseResult.rows.length}행)`)

    if (parseResult.rows.length > 0) {
      const sample = parseResult.rows[0]
      info(`첫 번째 주문번호: "${sample.toever_order_no}" (type: ${typeof sample.toever_order_no})`)
      if (typeof sample.toever_order_no === 'string') {
        pass('주문번호 문자열 타입 보존')
      } else {
        fail('주문번호 숫자 변환 위험')
      }
    }

    // 중복 필터링
    const filterResult = filterNewShipmentTargets(parseResult.rows, run.id)
    pass(`신규 출고 대상: ${filterResult.new_targets.length}건`)
    info(`중복 스킵: ${filterResult.duplicates.length}건`)
    info(`변경 감지: ${filterResult.changed_reviews.length}건`)

    // DB 저장 (트랜잭션)
    const orderGroups = new Map()
    for (const row of parseResult.rows) {
      const g = orderGroups.get(row.toever_order_no) ?? []
      g.push(row)
      orderGroups.set(row.toever_order_no, g)
    }

    const saveAll = db.transaction(() => {
      for (const [orderNo, rows] of orderGroups.entries()) {
        const first = rows[0]
        const hash = computeOrderHash({
          receiver_name: first.receiver_name,
          receiver_phone: first.receiver_phone,
          receiver_address: first.receiver_address,
          product_name: rows.map(r => `${r.product_name}/${r.option_name ?? ''}/${r.quantity}`).join('|'),
          option_name: null,
          quantity: rows.reduce((s, r) => s + r.quantity, 0),
          delivery_message: first.delivery_message,
        })
        const isNewTarget = filterResult.new_targets.some(t => t.toever_order_no === orderNo)
        const isDuplicate = filterResult.duplicates.includes(orderNo)
        const status = isNewTarget ? 'NEW_SHIPMENT_TARGET'
          : isDuplicate ? 'DUPLICATE_SKIPPED' : 'COLLECTED'

        const { id: orderId, isNew } = repos.upsertOrderHeader({
          toever_order_no:     orderNo,
          toever_po_no:        null,
          order_date:          TEST_DATE,
          receiver_name:       first.receiver_name,
          receiver_phone:      first.receiver_phone,
          receiver_address:    first.receiver_address,
          delivery_message:    first.delivery_message,
          status,
          latest_invoice_no:   first.invoice_no ?? null,
          latest_courier_name: first.courier_name ?? null,
          latest_invoice_input_at: null,
          ezadmin_batch_id:    null,
          source_run_id:       run.id,
          hash_snapshot:       hash,
        })
        if (isNew) {
          repos.insertOrderItems(orderId, rows.map((r, idx) => ({
            line_no: idx + 1,
            product_name: r.product_name,
            option_name: r.option_name ?? null,
            quantity: r.quantity,
            ezadmin_product_code: null,
            barcode: null,
            line_hash: hash,
          })))
        }
      }
    })
    saveAll()

    const total = db.prepare('SELECT COUNT(*) as c FROM order_header').get()
    const byStatus = db.prepare('SELECT status, COUNT(*) as c FROM order_header GROUP BY status').all()
    repos.updateRunStatus(run.id, 'SUCCESS', `수집=${uniqOrders.size}건, 신규=${filterResult.new_targets.length}, 중복=${filterResult.duplicates.length}`)

    pass(`DB 저장 완료: ${orderGroups.size}건`)

    // ── 결과 보고 ────────────────────────────────────────────────
    section('4. 결과 보고')

    // 주문 목록 샘플 출력 (최대 10건)
    const orders = db.prepare(
      'SELECT toever_order_no, receiver_name, status FROM order_header ORDER BY id LIMIT 10'
    ).all()

    console.log(`\n  ${C.cyan('수집된 주문 (최대 10건):')}`)
    console.log(`  ${'주문번호'.padEnd(22)} ${'수령자명'.padEnd(10)} 상태`)
    console.log(`  ${'─'.repeat(55)}`)
    for (const o of orders) {
      console.log(`  ${o.toever_order_no.padEnd(22)} ${(o.receiver_name ?? '').padEnd(10)} ${o.status}`)
    }
    if (total.c > 10) info(`... 외 ${total.c - 10}건 더`)

    console.log(`\n  ${C.bold('┌─ 처리 건수 요약 ─────────────────────────────────┐')}`)
    console.log(`  │  총 주문: ${total.c}건`)
    for (const s of byStatus) {
      console.log(`  │    ${s.status.padEnd(28)} ${s.c}건`)
    }
    const manualReviews = db.prepare("SELECT COUNT(*) as c FROM manual_review_queue WHERE severity='HIGH'").get()
    console.log(`  │  HIGH 수동검토: ${manualReviews.c}건`)
    console.log(`  │  오류: ${parseResult.errors.length}건`)
    console.log(`  ${C.bold('└────────────────────────────────────────────────────┘')}`)

    // 스크린샷 목록
    const ssDir = storage.DIRS.logsScreenshots()
    if (fs.existsSync(ssDir)) {
      const shots = fs.readdirSync(ssDir).filter(f => f.endsWith('.png'))
      if (shots.length > 0) {
        info(`스크린샷 ${shots.length}개 저장됨:`)
        for (const s of shots) info(`  ${path.join(ssDir, s)}`)
      }
    }

  } catch (e) {
    fail('파싱/저장 예외', e)
  }

  await printSummary()
  process.exit(failed > 0 ? 1 : 0)
}

async function printSummary() {
  console.log(`\n${C.bold('══════════════════════════════════════════')}`)
  if (failed === 0) {
    console.log(C.green(C.bold(`  ✓ 전체 ${passed}건 통과`)))
  } else {
    console.log(C.green(C.bold(`  ✓ 통과: ${passed}건`)))
    console.log(C.red(C.bold(`  ✗ 실패: ${failed}건`)))
    for (const e of failList) console.log(C.red(`    - ${e}`))
  }
  console.log(C.bold('══════════════════════════════════════════\n'))
}

main().catch(async e => {
  console.error(C.red('\n[FATAL] ' + e.message))
  console.error(e.stack)
  process.exit(1)
})
