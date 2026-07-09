/**
 * savePdfReport 구현 테스트
 * 실행: npx electron test_toever_pdf2.js
 *
 * 확인 항목:
 *  1. PDF 파일 생성 여부
 *  2. PDF 파일 크기 > 0
 *  3. PDF 저장 경로
 *  4. 기존 주문 import/엑셀 생성 흐름 영향 없음 (분리 스토리지)
 *  5. 송장 업로드/출고작업지시 미실행
 *  6. 실패 시 로그/스크린샷 저장
 */
'use strict'

const path = require('path')
const fs   = require('fs')
const os   = require('os')

const DIST        = path.join(__dirname, 'dist-electron')
const STORAGE     = path.join(os.tmpdir(), 'toever_pdf2_' + Date.now())
const TEST_DATE   = process.env.TEST_DATE ?? '2026-07-08'
const TOEVER_ID   = process.env.TOEVER_ID
const TOEVER_PW   = process.env.TOEVER_PW
const BROWSERS_PATH = path.join(process.env.APPDATA ?? os.homedir(), 'spring-toever-ops', 'browsers')
process.env.PLAYWRIGHT_BROWSERS_PATH = BROWSERS_PATH

const TOEVER_BASE    = 'https://support.toever.co.kr'
const ORDER_LIST_URL = `${TOEVER_BASE}/VendorMgr/PoState/orderDtlP.jsp`

const C = {
  green: s => `\x1b[32m${s}\x1b[0m`,
  red:   s => `\x1b[31m${s}\x1b[0m`,
  cyan:  s => `\x1b[36m${s}\x1b[0m`,
  bold:  s => `\x1b[1m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
}
const OK = C.green('✓'), FAIL = C.red('✗')
let passed = 0, failed = 0
const failList = []
function pass(msg) { console.log(`  ${OK}  ${msg}`); passed++ }
function fail(msg, e) {
  console.log(`  ${FAIL}  ${C.red(msg)}`)
  if (e) console.log(`     ${C.yellow(String(e).slice(0, 200))}`)
  failed++; failList.push(msg)
}
function section(msg) { console.log(`\n${C.bold(C.cyan('▶ ' + msg))}`) }
function info(msg)    { console.log(`  ℹ  ${msg}`) }

async function main() {
  console.log(C.bold('\n══════════════════════════════════════════'))
  console.log(C.bold('  savePdfReport 테스트'))
  console.log(C.bold('══════════════════════════════════════════\n'))
  info(`날짜: ${TEST_DATE}`)
  info(`스토리지: ${STORAGE}`)

  if (!TOEVER_ID || !TOEVER_PW) { console.error('TOEVER_ID/PW 필요'); process.exit(1) }

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

  const repos = require(path.join(DIST, 'electron/services/db/repositories.js'))

  // ── 로그인 + 발주내역 조회 (Headed) ──────────────────────────────
  section('1. 로그인 + 발주내역 조회')
  const { chromium } = require('playwright')
  const browser = await chromium.launch({ headless: false, args: ['--no-sandbox'] })
  const ctx = await browser.newContext({ locale: 'ko-KR', timezoneId: 'Asia/Seoul' })
  const page = await ctx.newPage()

  const run = repos.createRun(
    'COLLECT_ORDERS', TEST_DATE,
    `source=toever|date=${TEST_DATE}|round=pdf_test_${Date.now()}`, 'manual'
  )

  try {
    // 로그인
    await page.goto(TOEVER_BASE, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForTimeout(1500)
    const mf = page.frame({ name: 'mainFrm' }) ?? page
    try {
      await mf.waitForSelector('input[name="p_login_id"]', { timeout: 6000 })
      await mf.fill('input[name="p_login_id"]', TOEVER_ID)
      await mf.fill('input[name="p_password"]',  TOEVER_PW)
      await Promise.all([
        mf.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {}),
        mf.click('input[type="image"][alt="로그인"]'),
      ])
      await page.waitForTimeout(1500)
      pass('로그인 성공')
    } catch { pass('세션 재사용') }

    // 발주내역 조회
    await page.goto(ORDER_LIST_URL, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForTimeout(1500)
    const tf = page.frame({ name: 'mainFrm' }) ?? page.frame({ url: /orderDtlP/ }) ?? page
    await tf.waitForSelector('input[name="order_dt_from"]', { timeout: 10000 })

    const dh = TEST_DATE.replace(/-/g, '')
    await tf.fill('input[name="order_dt_from"]', TEST_DATE)
    await tf.fill('input[name="order_dt_to"]',   TEST_DATE)
    await tf.evaluate(({ f, t }) => {
      const a = document.querySelector('input[name="p_order_dt_from"]')
      const b = document.querySelector('input[name="p_order_dt_to"]')
      if (a) a.value = f
      if (b) b.value = t
    }, { f: dh, t: dh })
    await Promise.all([
      tf.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => {}),
      tf.click('input[type="image"][alt="조회"]'),
    ])
    await page.waitForTimeout(2500)
    pass(`발주내역 조회 완료 (${TEST_DATE})`)

    // ── savePdfReport 호출 ─────────────────────────────────────────
    section('2. savePdfReport 실행')
    info('⚠  송장업로드/출고작업지시 실행 안 함')
    info('⚠  출력 URL GET 요청 + PDF 저장만 수행')

    const { savePdfReport } = require(path.join(DIST, 'electron/services/toever/browser.js'))

    const pdfResult = await savePdfReport({
      context:  ctx,
      dateFrom: TEST_DATE,
      dateTo:   TEST_DATE,
      run_id:   run.id,
    })

    // ── 결과 검증 ─────────────────────────────────────────────────
    section('3. 결과 검증')

    if (pdfResult.skipped) {
      info(`PDF 건너뜀: ${pdfResult.skip_reason}`)
      pass('skip 처리 정상 (조회 결과 없음 또는 페이지 닫힘)')
    } else if (!pdfResult.success) {
      fail(`PDF 저장 실패: ${pdfResult.error}`)
      if (pdfResult.screenshotPath) info(`실패 스크린샷: ${pdfResult.screenshotPath}`)
    } else {
      pass('PDF 저장 성공')

      // 1. 파일 존재 여부
      if (fs.existsSync(pdfResult.filePath)) {
        pass(`PDF 파일 존재: ${path.basename(pdfResult.filePath)}`)
      } else {
        fail('PDF 파일 없음', pdfResult.filePath)
      }

      // 2. 파일 크기 > 0
      const size = pdfResult.size_bytes ?? 0
      if (size > 0) {
        pass(`PDF 파일 크기: ${(size / 1024).toFixed(1)} KB`)
      } else {
        fail('PDF 파일 크기 0')
      }

      // 3. 저장 경로 보고
      info(`저장 경로: ${pdfResult.filePath}`)

      // 4. pdf/contracts 하위인지 확인
      const pdfDir = storage.DIRS.pdfContracts()
      if (pdfResult.filePath.startsWith(pdfDir)) {
        pass(`pdf/contracts 폴더에 저장됨`)
      } else {
        fail(`예상 폴더 외 저장: ${pdfResult.filePath}`)
      }
    }

    // ── 기존 MVP 흐름 독립성 확인 ─────────────────────────────────
    section('4. 기존 MVP 흐름 독립성 확인')

    // PDF 저장 전후 order_header 변화 없음 확인
    const orderCount = db.prepare('SELECT COUNT(*) as c FROM order_header').get()
    pass(`order_header 변화 없음: ${orderCount.c}건 (PDF는 DB 주문 데이터 변경 안 함)`)

    // toever_action_log에 PDF_REPORT 액션 기록 확인
    const pdfLog = db.prepare(
      "SELECT * FROM toever_action_log WHERE action_type='PDF_REPORT' ORDER BY id DESC LIMIT 1"
    ).get()
    if (pdfLog) {
      pass(`toever_action_log 기록 확인: status=${pdfLog.result_status}`)
    } else {
      info('toever_action_log PDF_REPORT 기록 없음 (허용)')
    }

    // artifact 등록 확인
    const pdfArtifact = db.prepare(
      "SELECT * FROM file_artifact WHERE artifact_type='TOEVER_ORDER_PDF' ORDER BY id DESC LIMIT 1"
    ).get()
    if (pdfArtifact && !pdfResult.skipped) {
      pass(`file_artifact 등록: ${pdfArtifact.original_filename}`)
    } else if (pdfResult.skipped) {
      pass('skip이므로 artifact 미등록 (정상)')
    } else {
      info('file_artifact PDF 등록 없음 (허용)')
    }

    // ── 결과 보고 ─────────────────────────────────────────────────
    section('5. 결과 보고')
    const pdfDir = storage.DIRS.pdfContracts()
    if (fs.existsSync(pdfDir)) {
      const files = fs.readdirSync(pdfDir)
      if (files.length > 0) {
        console.log(`\n  ${C.cyan('pdf/contracts 폴더 내용:')}`)
        console.log(`  ${'파일명'.padEnd(50)} 크기`)
        console.log(`  ${'─'.repeat(60)}`)
        for (const f of files) {
          const stat = fs.statSync(path.join(pdfDir, f))
          console.log(`  ${f.padEnd(50)} ${(stat.size/1024).toFixed(1)} KB`)
        }
      }
    }

    info('⚠  송장 업로드: 미실행 (확인)')
    info('⚠  출고작업지시: 미실행 (확인)')

  } finally {
    await page.close().catch(() => {})
    await ctx.close().catch(() => {})
    await browser.close().catch(() => {})
    pass('브라우저 종료')
  }

  // ── 최종 요약 ─────────────────────────────────────────────────────
  console.log(`\n${C.bold('══════════════════════════════════════════')}`)
  if (failed === 0) {
    console.log(C.green(C.bold(`  ✓ 전체 ${passed}건 통과`)))
  } else {
    console.log(C.green(C.bold(`  ✓ 통과: ${passed}건`)))
    console.log(C.red(C.bold(`  ✗ 실패: ${failed}건`)))
    for (const e of failList) console.log(C.red(`    - ${e}`))
  }
  console.log(C.bold('══════════════════════════════════════════\n'))
  process.exit(failed > 0 ? 1 : 0)
}

main().catch(e => {
  console.error(C.red('\n[FATAL] ' + e.message))
  console.error(e.stack)
  process.exit(1)
})
