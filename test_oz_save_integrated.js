/**
 * savePdfReport() 통합 테스트 — OZ 저장 버튼 방식
 *
 * 실행: npx electron test_oz_save_integrated.js
 */
'use strict'

const path = require('path')
const fs   = require('fs')
const os   = require('os')

const DIST      = path.join(__dirname, 'dist-electron')
const BASE_PATH = path.join(os.homedir(), 'toever-data')
const TEST_DATE = '2026-07-09'
const TOEVER_BASE    = 'https://support.toever.co.kr'
const ORDER_LIST_URL = `${TOEVER_BASE}/VendorMgr/PoState/orderDtlP.jsp`

const TOEVER_ID = process.env.TOEVER_ID ?? 'B0000117'
const TOEVER_PW = process.env.TOEVER_PW ?? 'unit'

process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(
  process.env.APPDATA ?? os.homedir(),
  'spring-toever-ops', 'browsers'
)

const C = {
  bold:   s => `\x1b[1m${s}\x1b[0m`,
  cyan:   s => `\x1b[36m${s}\x1b[0m`,
  green:  s => `\x1b[32m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
  red:    s => `\x1b[31m${s}\x1b[0m`,
  gray:   s => `\x1b[90m${s}\x1b[0m`,
}
const info    = m => console.log(`  ${C.gray('ℹ')}  ${m}`)
const warn    = m => console.log(`  ${C.yellow('⚠')}  ${C.yellow(m)}`)
const found   = m => console.log(`  ${C.green('✓')}  ${m}`)
const fail    = m => console.log(`  ${C.red('✗')}  ${C.red(m)}`)
const section = m => console.log(`\n${C.bold(C.cyan('▶ ' + m))}`)

async function main() {
  console.log(C.bold('\n══════════════════════════════════════════════'))
  console.log(C.bold('  savePdfReport() 통합 테스트 (OZ 저장 버튼 방식)'))
  console.log(C.bold(`  날짜: ${TEST_DATE}`))
  console.log(C.bold('══════════════════════════════════════════════\n'))

  const storage = require(path.join(DIST, 'electron/services/storage.js'))
  storage.setBasePath(BASE_PATH)
  storage.ensureAllDirs()
  const { initDb } = require(path.join(DIST, 'electron/services/db/schema.js'))
  initDb(BASE_PATH)
  const browser = require(path.join(DIST, 'electron/services/toever/browser.js'))
  const ssDir  = storage.DIRS.logsScreenshots()

  let bSession = null
  try {
    // 1. 로그인
    section('1. 로그인')
    bSession = await browser.launchBrowser(ssDir)
    const { page: mainPage, context } = bSession
    const lr = await browser.loginToever(mainPage, TOEVER_ID, TOEVER_PW)
    if (!lr.success) throw new Error(`로그인 실패: ${lr.error}`)
    info('로그인 성공')

    // 2. 발주내역 조회
    section('2. 발주내역 조회')
    await mainPage.goto(ORDER_LIST_URL, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await mainPage.waitForTimeout(2000)
    const frame = mainPage.frame({ name: 'mainFrm' }) ?? mainPage
    await frame.waitForSelector('input[name="order_dt_from"]', { timeout: 15000 })
    const dc = TEST_DATE.replace(/-/g, '')
    await frame.fill('input[name="order_dt_from"]', TEST_DATE)
    await frame.fill('input[name="order_dt_to"]',   TEST_DATE)
    await frame.evaluate(d => {
      const f = document.querySelector('input[name="p_order_dt_from"]')
      const t = document.querySelector('input[name="p_order_dt_to"]')
      if (f) f.value = d; if (t) t.value = d
    }, dc)
    await Promise.all([
      frame.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {}),
      frame.click('input[type="image"][alt="조회"]'),
    ])
    await mainPage.waitForTimeout(3000)
    info('조회 완료')

    // 3. savePdfReport() 호출
    section('3. savePdfReport() 호출')
    const result = await browser.savePdfReport({
      context,
      dateFrom: TEST_DATE,
      dateTo:   TEST_DATE,
    })

    // 4. 결과 보고
    section('4. 결과')
    if (result.success) {
      found(`성공: ${result.filePath}`)
      found(`크기: ${result.size_bytes?.toLocaleString()} bytes`)
    } else if (result.skipped) {
      warn(`스킵: ${result.skip_reason}`)
    } else {
      fail(`실패: ${result.error}`)
      if (result.screenshotPath) info(`스크린샷: ${result.screenshotPath}`)
    }

    console.log()
    const row = (no, label, value, ok) => {
      const mark = ok === undefined ? '  ' : ok ? C.green(' ✓') : C.red(' ✗')
      const v    = !value && value !== 0 ? C.gray('(없음)') : C.cyan(String(value))
      console.log(`${mark}  ${C.bold(String(no).padStart(2) + '.')} ${label.padEnd(30)} ${v}`)
    }
    row(1, 'savePdfReport 성공',    result.success ? 'YES' : 'NO', result.success)
    row(2, '파일 경로',             result.filePath, undefined)
    row(3, '파일 크기',             result.size_bytes > 0 ? `${result.size_bytes?.toLocaleString()} bytes` : '0', result.success ? result.size_bytes > 0 : undefined)
    row(4, 'page.pdf() 방식 폐기', result.success ? '폐기됨 (OZ 저장 버튼 방식 채택)' : '유지 필요', undefined)
    row(5, '스킵 여부',             result.skipped ? result.skip_reason : 'NO', undefined)
    row(6, '오류',                  result.error ?? 'NONE', undefined)
    console.log()

  } catch (err) {
    warn(`오류: ${err.message}`)
    console.error(err.stack)
  } finally {
    if (bSession) { info('브라우저 종료...'); await browser.closeBrowser() }
  }
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(C.red('\n[FATAL] ' + err.message))
    process.exit(1)
  })
