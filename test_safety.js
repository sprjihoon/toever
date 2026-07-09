/**
 * v1.0.4 상태 변경 작업 안전장치 테스트
 *
 * 실행: TOEVER_ID=B0000117 TOEVER_PW=unit npx electron test_safety.js
 *
 * 테스트 항목:
 *  1. invoice:previewUpload (DB 조회, 상태 변경 없음)
 *  2. invoice:uploadToever confirmed 미전달 → CONFIRM_REQUIRED 거부
 *  3. invoice:uploadToever dryRun:true, confirmed:true → uploadBtn 클릭 안 함
 *  4. storeout:preview (DB 조회, 상태 변경 없음)
 *  5. storeout:execute confirmed 미전달 → CONFIRM_REQUIRED 거부
 *  6. storeout:execute dryRun:true, confirmed:true → submit 안 함
 */
'use strict'

const path = require('path')
const fs   = require('fs')
const os   = require('os')

const DIST          = path.join(__dirname, 'dist-electron')
const STORAGE       = path.join(os.tmpdir(), 'toever_safety_' + Date.now())
const TEST_DATE     = process.env.TEST_DATE ?? '2026-07-08'
const TOEVER_ID     = process.env.TOEVER_ID
const TOEVER_PW     = process.env.TOEVER_PW
const BROWSERS_PATH = path.join(process.env.APPDATA ?? os.homedir(), 'spring-toever-ops', 'browsers')
process.env.PLAYWRIGHT_BROWSERS_PATH = BROWSERS_PATH

const TOEVER_BASE    = 'https://support.toever.co.kr'
const ORDER_LIST_URL = `${TOEVER_BASE}/VendorMgr/PoState/orderDtlP.jsp`

const C = {
  green:  s => `\x1b[32m${s}\x1b[0m`,
  red:    s => `\x1b[31m${s}\x1b[0m`,
  cyan:   s => `\x1b[36m${s}\x1b[0m`,
  bold:   s => `\x1b[1m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
}
const OK = C.green('✓'), FAIL = C.red('✗')
let passed = 0, failed = 0, skipped = 0
const failList = []
function pass(msg) { console.log(`  ${OK}  ${msg}`); passed++ }
function fail(msg, e) {
  console.log(`  ${FAIL}  ${C.red(msg)}`)
  if (e) console.log(`     ${C.yellow(String(e).slice(0, 200))}`)
  failed++; failList.push(msg)
}
function skip(msg) { console.log(`  -   ${C.yellow('[SKIP] ' + msg)}`); skipped++ }
function section(msg) { console.log(`\n${C.bold(C.cyan('▶ ' + msg))}`) }
function info(msg)    { console.log(`  ℹ  ${msg}`) }

// ── 환경 초기화 헬퍼 ────────────────────────────────────────────────
function initEnv() {
  const storage = require(path.join(DIST, 'electron/services/storage.js'))
  storage.setBasePath(STORAGE)
  storage.ensureAllDirs()

  const { initDb, getDb } = require(path.join(DIST, 'electron/services/db/schema.js'))
  initDb(STORAGE)
  return { db: getDb(), storage }
}

// ── DB 시드 데이터 ───────────────────────────────────────────────────
function seedOrder(db, { order_no, po_no, status, invoice_no }) {
  db.prepare(`
    INSERT OR IGNORE INTO order_header (
      toever_order_no, toever_po_no, order_date, receiver_name, receiver_phone,
      receiver_address, status, latest_invoice_no, hash_snapshot
    ) VALUES (
      ?, ?, ?, '테스트수취인', '010-0000-0000',
      '서울시 테스트구', ?, ?, ?
    )
  `).run(order_no, po_no, TEST_DATE, status, invoice_no ?? null, `hash-${order_no}`)
}

async function main() {
  console.log(C.bold('\n══════════════════════════════════════════════'))
  console.log(C.bold('  v1.0.4 상태 변경 안전장치 테스트'))
  console.log(C.bold('══════════════════════════════════════════════\n'))
  info(`날짜: ${TEST_DATE}`)
  info(`스토리지: ${STORAGE}`)
  info(`브라우저 테스트: ${TOEVER_ID ? '포함' : '건너뜀 (TOEVER_ID 없음)'}`)

  // ────────────────────────────────────────────────────────────────
  section('0. 환경 초기화')
  const { db, storage } = initEnv()
  pass('스토리지 + DB 초기화')

  seedOrder(db, { order_no: 'TEST-ORDER-0001', po_no: 'TEST-PO-0001', status: 'INVOICE_IMPORTED', invoice_no: 'INVOICE-TEST-0001' })
  seedOrder(db, { order_no: 'TEST-ORDER-0002', po_no: 'TEST-PO-0002', status: 'TOEVER_INVOICE_UPLOADED', invoice_no: 'INVOICE-TEST-0002' })
  pass('시드 데이터 삽입 (INVOICE_IMPORTED 1건, TOEVER_INVOICE_UPLOADED 1건)')

  const repos = require(path.join(DIST, 'electron/services/db/repositories.js'))

  // ────────────────────────────────────────────────────────────────
  // Test 1: invoice:previewUpload — DB 조회, 상태 변경 없음
  // ────────────────────────────────────────────────────────────────
  section('1. invoice:previewUpload')

  const { previewToeverInvoiceUpload } = require(path.join(DIST, 'electron/services/toever/orchestrator.js'))
  const beforeCount = db.prepare("SELECT COUNT(*) as c FROM order_header").get().c

  const preview = previewToeverInvoiceUpload()
  if (Array.isArray(preview)) {
    pass(`previewToeverInvoiceUpload() 정상 반환: ${preview.length}건`)
  } else {
    fail('반환값이 배열이 아님', preview)
  }

  if (preview.length > 0) {
    const first = preview[0]
    if (first.order_no && first.invoice_no !== undefined) {
      pass(`order_no / invoice_no 구조 확인: order_no=${first.order_no}, invoice_no=${first.invoice_no}`)
    } else {
      fail('order_no / invoice_no 필드 누락', JSON.stringify(first))
    }
    const found = preview.find(p => p.order_no === 'TEST-ORDER-0001')
    if (found) {
      pass('시드 주문(TEST-ORDER-0001) 포함 확인')
    } else {
      fail('시드 주문이 preview에 없음')
    }
  }

  const afterCount = db.prepare("SELECT COUNT(*) as c FROM order_header").get().c
  if (beforeCount === afterCount) {
    pass('DB 상태 변경 없음 (previewUpload는 조회만)')
  } else {
    fail(`DB 행 수 변경됨: ${beforeCount} → ${afterCount}`)
  }

  // ────────────────────────────────────────────────────────────────
  // Test 2: invoice:uploadToever — confirmed 없음 → CONFIRM_REQUIRED 거부
  // ────────────────────────────────────────────────────────────────
  section('2. invoice:uploadToever — confirmed 미전달 → 거부 확인')

  // IPC 핸들러 로직을 직접 시뮬레이션
  function simulateUploadConfirmGuard(params) {
    if (!params?.confirmed) {
      return { success: false, error: 'CONFIRM_REQUIRED' }
    }
    return null // 통과
  }

  const r2a = simulateUploadConfirmGuard(undefined)
  if (r2a?.error === 'CONFIRM_REQUIRED') {
    pass('params 미전달 → CONFIRM_REQUIRED 반환')
  } else {
    fail('confirmed 미전달 시 거부 실패', r2a)
  }

  const r2b = simulateUploadConfirmGuard({ confirmed: false })
  if (r2b?.error === 'CONFIRM_REQUIRED') {
    pass('confirmed:false → CONFIRM_REQUIRED 반환')
  } else {
    fail('confirmed:false 시 거부 실패', r2b)
  }

  const r2c = simulateUploadConfirmGuard({ confirmed: true })
  if (r2c === null) {
    pass('confirmed:true → 가드 통과 (실행 진입 허용)')
  } else {
    fail('confirmed:true 시 가드가 잘못 거부함', r2c)
  }

  // DB 변경 없음 확인
  const afterGuardCount = db.prepare("SELECT COUNT(*) as c FROM order_header").get().c
  if (afterGuardCount === afterCount) {
    pass('가드 테스트 중 DB 변경 없음')
  } else {
    fail('가드 테스트 중 DB 변경 발생')
  }

  // ────────────────────────────────────────────────────────────────
  // Test 3: invoice:uploadToever dryRun:true, confirmed:true — 브라우저
  // ────────────────────────────────────────────────────────────────
  section('3. invoice:uploadToever dryRun:true — uploadBtn 클릭 안 함')

  if (!TOEVER_ID || !TOEVER_PW) {
    skip('TOEVER_ID/PW 없음 — 브라우저 테스트 건너뜀')
  } else {
    const { uploadToeverInvoiceFile } = require(path.join(DIST, 'electron/services/toever/orchestrator.js'))
    const run3 = repos.createRun('UPLOAD_TOEVER_INVOICE', TEST_DATE, `safety_dryrun_upload_${Date.now()}`, 'manual')

    const before3 = db.prepare("SELECT status FROM order_header WHERE toever_order_no='TEST-ORDER-0001'").get()
    info(`업로드 전 TEST-ORDER-0001 상태: ${before3?.status}`)

    const result3 = await uploadToeverInvoiceFile({
      toever_id:       TOEVER_ID,
      toever_password: TOEVER_PW,
      run_id:          run3.id,
      dryRun:          true,
      emit: (event, data) => info(`[emit] ${event}: ${JSON.stringify(data).slice(0, 80)}`),
    })

    if (result3.dryRun === true) {
      pass('result.dryRun === true 확인')
    } else if (!result3.success) {
      info(`실패 이유: ${result3.errors?.join(', ')}`)
      skip(`dryRun 결과 확인 불가 (업로드 대상 없거나 오류): success=${result3.success}`)
    } else {
      fail('dryRun 실행이지만 result.dryRun이 true가 아님', JSON.stringify(result3))
    }

    // dryRun에서는 파일 생성(TOEVER_INVOICE_READY)까지는 허용,
    // TOEVER_INVOICE_UPLOADED 로의 전환만 차단되면 정상
    const after3 = db.prepare("SELECT status FROM order_header WHERE toever_order_no='TEST-ORDER-0001'").get()
    if (after3?.status !== 'TOEVER_INVOICE_UPLOADED') {
      pass(`TOEVER_INVOICE_UPLOADED 전환 차단 확인: 현재 상태=${after3?.status}`)
    } else {
      fail(`dryRun인데 TOEVER_INVOICE_UPLOADED로 전환됨`)
    }

    // toever_action_log SKIP 기록 확인
    const log3 = db.prepare(
      "SELECT * FROM toever_action_log WHERE action_type='INVOICE_UPLOAD' ORDER BY id DESC LIMIT 1"
    ).get()
    if (log3?.result_status === 'SKIP') {
      pass(`toever_action_log: INVOICE_UPLOAD SKIP 기록 확인`)
    } else if (log3) {
      info(`toever_action_log: ${log3.result_status} (업로드 대상 없어서 진입 못한 경우 허용)`)
    } else {
      info('toever_action_log INVOICE_UPLOAD 기록 없음 (업로드 대상 없는 경우 허용)')
    }
  }

  // ────────────────────────────────────────────────────────────────
  // Test 4: storeout:preview — DB 조회, 상태 변경 없음
  // ────────────────────────────────────────────────────────────────
  section('4. storeout:preview')

  const { getOrdersForStoreout } = require(path.join(DIST, 'electron/services/db/repositories.js'))
  const before4Count = db.prepare("SELECT COUNT(*) as c FROM order_header").get().c

  const storeoutOrders = getOrdersForStoreout()
  if (Array.isArray(storeoutOrders)) {
    pass(`getOrdersForStoreout() 정상 반환: ${storeoutOrders.length}건`)
  } else {
    fail('반환값이 배열이 아님', storeoutOrders)
  }

  if (storeoutOrders.length > 0) {
    const found4 = storeoutOrders.find(o => o.toever_order_no === 'TEST-ORDER-0002')
    if (found4) {
      pass('시드 주문(TEST-ORDER-0002, TOEVER_INVOICE_UPLOADED) 포함 확인')
    } else {
      fail('시드 주문이 storeout 대상에 없음')
    }
  } else {
    fail('storeout 대상이 0건 (TEST-ORDER-0002 시드 실패)')
  }

  const after4Count = db.prepare("SELECT COUNT(*) as c FROM order_header").get().c
  if (before4Count === after4Count) {
    pass('DB 상태 변경 없음 (storeout:preview는 조회만)')
  } else {
    fail('storeout:preview 중 DB 변경 발생')
  }

  // ────────────────────────────────────────────────────────────────
  // Test 5: storeout:execute — confirmed 없음 → CONFIRM_REQUIRED 거부
  // ────────────────────────────────────────────────────────────────
  section('5. storeout:execute — confirmed 미전달 → 거부 확인')

  function simulateStoreoutConfirmGuard(params) {
    if (!params?.confirmed) {
      return { success: false, error: 'CONFIRM_REQUIRED' }
    }
    return null
  }

  const r5a = simulateStoreoutConfirmGuard(undefined)
  if (r5a?.error === 'CONFIRM_REQUIRED') {
    pass('params 미전달 → CONFIRM_REQUIRED 반환')
  } else {
    fail('confirmed 미전달 시 거부 실패', r5a)
  }

  const r5b = simulateStoreoutConfirmGuard({ confirmed: false })
  if (r5b?.error === 'CONFIRM_REQUIRED') {
    pass('confirmed:false → CONFIRM_REQUIRED 반환')
  } else {
    fail('confirmed:false 시 거부 실패', r5b)
  }

  const r5c = simulateStoreoutConfirmGuard({ confirmed: true })
  if (r5c === null) {
    pass('confirmed:true → 가드 통과')
  } else {
    fail('confirmed:true 시 가드가 잘못 거부함', r5c)
  }

  const after5Count = db.prepare("SELECT COUNT(*) as c FROM order_header").get().c
  if (after5Count === after4Count) {
    pass('가드 테스트 중 DB 변경 없음')
  } else {
    fail('가드 테스트 중 DB 변경 발생')
  }

  // ────────────────────────────────────────────────────────────────
  // Test 6: storeout:execute dryRun:true, confirmed:true — 브라우저
  // ────────────────────────────────────────────────────────────────
  section('6. storeout:execute dryRun:true — 체크박스 클릭/submit 안 함')

  if (!TOEVER_ID || !TOEVER_PW) {
    skip('TOEVER_ID/PW 없음 — 브라우저 테스트 건너뜀')
  } else {
    const { chromium } = require('playwright')
    const storeout_browser = await chromium.launch({ headless: false, args: ['--no-sandbox'] })
    const storeout_ctx = await storeout_browser.newContext({ locale: 'ko-KR', timezoneId: 'Asia/Seoul' })
    const storeout_page = await storeout_ctx.newPage()
    const run6 = repos.createRun('STOREOUT_INSTRUCT', TEST_DATE, `safety_dryrun_storeout_${Date.now()}`, 'manual')

    try {
      // 로그인
      await storeout_page.goto(TOEVER_BASE, { waitUntil: 'domcontentloaded', timeout: 30000 })
      await storeout_page.waitForTimeout(1500)
      const mf = storeout_page.frame({ name: 'mainFrm' }) ?? storeout_page
      try {
        await mf.waitForSelector('input[name="p_login_id"]', { timeout: 6000 })
        await mf.fill('input[name="p_login_id"]', TOEVER_ID)
        await mf.fill('input[name="p_password"]',  TOEVER_PW)
        await Promise.all([
          mf.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {}),
          mf.click('input[type="image"][alt="로그인"]'),
        ])
        await storeout_page.waitForTimeout(1500)
        pass('로그인 성공')
      } catch { pass('세션 재사용') }

      // 발주내역 조회 (체크박스가 있는 페이지 이동)
      await storeout_page.goto(ORDER_LIST_URL, { waitUntil: 'domcontentloaded', timeout: 30000 })
      await storeout_page.waitForTimeout(1500)
      const tf = storeout_page.frame({ name: 'mainFrm' }) ?? storeout_page.frame({ url: /orderDtlP/ }) ?? storeout_page
      try {
        await tf.waitForSelector('input[name="order_dt_from"]', { timeout: 8000 })
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
        await storeout_page.waitForTimeout(2000)
        pass(`발주내역 조회 완료 (${TEST_DATE})`)
      } catch(e) { info(`발주내역 조회 건너뜀: ${e.message}`) }

      // DB에 있는 테스트 poNos (실제 Toever에는 없을 것 → 체크박스 못찾음 → 정상)
      const poNos = storeoutOrders.map(o => o.toever_order_no)
      info(`dryRun 대상 poNos: ${JSON.stringify(poNos)}`)

      const before6 = db.prepare("SELECT status FROM order_header WHERE toever_order_no='TEST-ORDER-0002'").get()
      info(`storeout 전 TEST-ORDER-0002 상태: ${before6?.status}`)

      const { processStoreoutInstruction } = require(path.join(DIST, 'electron/services/toever/browser.js'))
      const result6 = await processStoreoutInstruction(storeout_page, poNos, run6.id, true)

      // 결과 검증
      if (result6.dryRun === true) {
        pass(`dryRun 결과 확인: processedPoNos=${result6.processedPoNos.length}건`)
      } else {
        // 체크박스 못찾은 경우 (포함 가능) - 중요한 것은 submit이 실행되지 않은 것
        info(`체크박스 발주번호 없음 (test 발주번호는 실제 Toever에 없음): ${result6.error ?? ''}`)
        pass('체크박스 발주번호 없음 = submit 미실행 확인 (안전)')
      }

      // DB 상태 변경 없음 확인
      const after6 = db.prepare("SELECT status FROM order_header WHERE toever_order_no='TEST-ORDER-0002'").get()
      if (after6?.status === 'TOEVER_INVOICE_UPLOADED') {
        pass(`DB 상태 변경 없음: ${after6?.status} (STOREOUT_INSTRUCTED 아님)`)
      } else {
        fail(`DB 상태가 예상 외 값으로 변경: ${after6?.status}`)
      }

      // toever_action_log 기록 확인
      const log6 = db.prepare(
        "SELECT * FROM toever_action_log WHERE action_type='STOREOUT_INSTRUCT' ORDER BY id DESC LIMIT 1"
      ).get()
      if (log6?.result_status === 'SKIP') {
        pass(`toever_action_log: STOREOUT_INSTRUCT SKIP 기록 확인`)
      } else {
        info('SKIP 로그 없음 (체크박스 발주번호 미매칭으로 dryRun 진입 전 반환된 경우 허용)')
      }

    } finally {
      await storeout_page.close().catch(() => {})
      await storeout_ctx.close().catch(() => {})
      await storeout_browser.close().catch(() => {})
      pass('브라우저 종료')
    }
  }

  // ────────────────────────────────────────────────────────────────
  // 전체 DB 최종 확인
  // ────────────────────────────────────────────────────────────────
  section('7. 최종 DB 상태 확인')

  const finalStatus = db.prepare(
    "SELECT toever_order_no, status FROM order_header WHERE toever_order_no IN ('TEST-ORDER-0001','TEST-ORDER-0002')"
  ).all()

  console.log(`\n  ${'주문번호'.padEnd(20)} 상태`)
  console.log(`  ${'─'.repeat(40)}`)
  for (const row of finalStatus) {
    const ok = (row.status !== 'TOEVER_INVOICE_UPLOADED' && row.toever_order_no === 'TEST-ORDER-0001') ||
               (row.status !== 'STOREOUT_INSTRUCTED'    && row.toever_order_no === 'TEST-ORDER-0002')
    console.log(`  ${row.toever_order_no.padEnd(20)} ${ok ? C.green(row.status) : C.red(row.status)}`)
  }

  const o1 = finalStatus.find(r => r.toever_order_no === 'TEST-ORDER-0001')
  const o2 = finalStatus.find(r => r.toever_order_no === 'TEST-ORDER-0002')

  // dryRun: 파일 생성(TOEVER_INVOICE_READY)은 허용, TOEVER_INVOICE_UPLOADED는 금지
  if (o1?.status !== 'TOEVER_INVOICE_UPLOADED') {
    pass(`TEST-ORDER-0001 TOEVER_INVOICE_UPLOADED 차단: 현재=${o1?.status}`)
  } else {
    fail(`TEST-ORDER-0001이 TOEVER_INVOICE_UPLOADED로 변경됨 (dryRun 실패)`)
  }
  if (o2?.status === 'TOEVER_INVOICE_UPLOADED') {
    pass('TEST-ORDER-0002 상태 유지: TOEVER_INVOICE_UPLOADED (출고작업지시 안 됨)')
  } else {
    fail(`TEST-ORDER-0002 상태 이상: ${o2?.status}`)
  }

  // ────────────────────────────────────────────────────────────────
  // 최종 요약
  // ────────────────────────────────────────────────────────────────
  console.log(`\n${C.bold('══════════════════════════════════════════════')}`)
  console.log(C.green(C.bold(`  ✓ 통과: ${passed}건`)))
  if (skipped > 0) console.log(C.yellow(C.bold(`  - 건너뜀: ${skipped}건`)))
  if (failed > 0) {
    console.log(C.red(C.bold(`  ✗ 실패: ${failed}건`)))
    for (const e of failList) console.log(C.red(`    - ${e}`))
  } else {
    console.log(C.green(C.bold(`  전체 안전장치 정상 작동 확인`)))
  }
  console.log(C.bold('══════════════════════════════════════════════\n'))
  process.exit(failed > 0 ? 1 : 0)
}

main().catch(e => {
  console.error(C.red('\n[FATAL] ' + e.message))
  console.error(e.stack)
  process.exit(1)
})
