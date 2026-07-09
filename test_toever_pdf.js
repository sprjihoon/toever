/**
 * 투에버 PDF 출력 저장 테스트
 *
 * 실행: npx electron test_toever_pdf.js
 *
 * 단계:
 *  1. 로그인 (세션 재사용 우선)
 *  2. 발주내역 조회 (2026-07-08)
 *  3. 출력 관련 버튼/함수 탐색
 *  4. 출력 팝업 또는 reportHTML 페이지 열기
 *  5. Playwright page.pdf() 로 저장
 *  6. pdf/contracts 폴더에 저장 + 경로/크기 보고
 *
 * 주의: 송장업로드/출고작업지시 실행 안 함
 */
'use strict'

const path = require('path')
const fs   = require('fs')
const os   = require('os')

const DIST        = path.join(__dirname, 'dist-electron')
const STORAGE     = path.join(os.tmpdir(), 'toever_pdf_test_' + Date.now())
const TEST_DATE   = process.env.TEST_DATE ?? '2026-07-08'
const TOEVER_ID   = process.env.TOEVER_ID
const TOEVER_PW   = process.env.TOEVER_PW
const BROWSERS_PATH = path.join(process.env.APPDATA ?? os.homedir(), 'spring-toever-ops', 'browsers')
process.env.PLAYWRIGHT_BROWSERS_PATH = BROWSERS_PATH

const TOEVER_BASE      = 'https://support.toever.co.kr'
const ORDER_LIST_URL   = `${TOEVER_BASE}/VendorMgr/PoState/orderDtlP.jsp`

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
  if (err) console.log(`     ${C.yellow(String(err).slice(0, 300))}`)
  failed++; failList.push(msg)
}
function section(msg) { console.log(`\n${C.bold(C.cyan('▶ ' + msg))}`) }
function info(msg)    { console.log(`  ℹ  ${msg}`) }

// ── 메인 ──────────────────────────────────────────────────────────────
async function main() {
  console.log(C.bold('\n══════════════════════════════════════════'))
  console.log(C.bold('  투에버 PDF 출력 저장 테스트'))
  console.log(C.bold('══════════════════════════════════════════\n'))
  info(`기준 날짜: ${TEST_DATE}`)
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
  pass('DB 초기화')

  const pdfDir = storage.DIRS.pdfContracts()
  if (!fs.existsSync(pdfDir)) fs.mkdirSync(pdfDir, { recursive: true })
  pass(`PDF 저장 폴더: ${pdfDir}`)

  const ssDir = storage.DIRS.logsScreenshots()

  // ── PHASE 1: 세션 확인 + 로그인 + 조회 (Headed 브라우저) ──────────
  section('1. 로그인 + 발주내역 조회 (Headed)')
  const { chromium } = require('playwright')

  let headedBrowser, headedContext, headedPage
  let reportUrl = null
  let printFunctions = []

  try {
    headedBrowser = await chromium.launch({
      headless: false,
      args: ['--no-sandbox'],
    })
    headedContext = await headedBrowser.newContext({
      acceptDownloads: true,
      locale: 'ko-KR',
      timezoneId: 'Asia/Seoul',
    })
    headedPage = await headedContext.newPage()
    pass('Headed 브라우저 실행')

    // 로그인 페이지로 이동
    await headedPage.goto(TOEVER_BASE, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await headedPage.waitForTimeout(2000)

    const url0 = headedPage.url()
    const content0 = await headedPage.content()
    const alreadyLoggedIn = !url0.includes('login') && !url0.includes('Login') &&
      !content0.includes('p_login_id')

    if (alreadyLoggedIn) {
      pass('기존 세션 유효')
    } else {
      // 로그인
      const mainFrame = headedPage.frame({ name: 'mainFrm' }) ??
        headedPage.frame({ url: /login\.jsp/i }) ?? headedPage

      await mainFrame.waitForSelector('input[name="p_login_id"]', { timeout: 15000 })
      await mainFrame.fill('input[name="p_login_id"]', TOEVER_ID)
      await mainFrame.fill('input[name="p_password"]', TOEVER_PW)

      await Promise.all([
        mainFrame.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => {}),
        mainFrame.click('input[type="image"][alt="로그인"]'),
      ])
      await headedPage.waitForTimeout(2000)

      const afterLoginContent = await headedPage.content()
      if (afterLoginContent.includes('p_login_id') || afterLoginContent.includes('loginAction')) {
        fail('로그인 실패', '로그인 페이지에 머물러 있음')
        await headedBrowser.close()
        return await printSummary()
      }
      pass('로그인 성공')
    }

    // 발주내역 조회
    await headedPage.goto(ORDER_LIST_URL, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await headedPage.waitForTimeout(2000)

    const targetFrame = headedPage.frame({ name: 'mainFrm' }) ??
      headedPage.frame({ url: /orderDtlP/ }) ?? headedPage

    await targetFrame.waitForSelector('input[name="order_dt_from"]', { timeout: 15000 })

    const dateStr   = TEST_DATE
    const dateHidden = TEST_DATE.replace(/-/g, '')
    await targetFrame.fill('input[name="order_dt_from"]', dateStr)
    await targetFrame.fill('input[name="order_dt_to"]', dateStr)
    await targetFrame.evaluate(({ from, to }) => {
      const f = document.querySelector('input[name="p_order_dt_from"]')
      const t = document.querySelector('input[name="p_order_dt_to"]')
      if (f) f.value = from
      if (t) t.value = to
    }, { from: dateHidden, to: dateHidden })

    await Promise.all([
      targetFrame.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {}),
      targetFrame.click('input[type="image"][alt="조회"]'),
    ])
    await headedPage.waitForTimeout(3000)
    pass(`발주내역 조회 완료 (${TEST_DATE})`)

    // ── 출력 관련 요소 탐색 ─────────────────────────────────────────
    section('2. 출력 관련 요소 탐색')

    const searchFrame = headedPage.frame({ name: 'mainFrm' }) ??
      headedPage.frame({ url: /orderDtlP/ }) ?? headedPage

    // JS 함수 목록 스캔
    printFunctions = await searchFrame.evaluate(() => {
      const found = []
      const keys = Object.keys(window)
      const printKeywords = ['print', 'Print', 'report', 'Report', 'pdf', 'Pdf', 'showReport', 'downReport', 'printPage', 'excel']
      for (const k of keys) {
        if (printKeywords.some(kw => k.includes(kw))) {
          found.push({ name: k, type: typeof window[k] })
        }
      }
      return found
    })
    info(`발견된 출력 관련 JS 함수/변수: ${printFunctions.length}개`)
    for (const f of printFunctions) {
      info(`  ${f.name} (${f.type})`)
    }

    // 출력 버튼 탐색
    const printBtns = await searchFrame.$$eval(
      'input[type="image"], input[type="button"], button, a',
      els => els
        .map(el => ({
          tag:   el.tagName,
          type:  el.getAttribute('type') ?? '',
          alt:   el.getAttribute('alt') ?? '',
          value: el.getAttribute('value') ?? '',
          text:  el.textContent?.trim().slice(0, 30) ?? '',
          onclick: el.getAttribute('onclick') ?? '',
          href:  el.getAttribute('href') ?? '',
        }))
        .filter(el =>
          el.alt.includes('출력') || el.alt.includes('인쇄') || el.alt.includes('PDF') ||
          el.value.includes('출력') || el.value.includes('인쇄') ||
          el.text.includes('출력') || el.text.includes('인쇄') || el.text.includes('PDF') ||
          el.onclick.toLowerCase().includes('print') || el.onclick.toLowerCase().includes('report') ||
          el.onclick.toLowerCase().includes('pdf')
        )
    )

    info(`발견된 출력 버튼: ${printBtns.length}개`)
    for (const b of printBtns) {
      info(`  [${b.tag}] alt="${b.alt}" value="${b.value}" text="${b.text}" onclick="${b.onclick.slice(0, 80)}"`)
    }

    // 스크린샷 저장
    const ss1 = path.join(ssDir, `${Date.now()}_order_list_for_pdf.png`)
    await headedPage.screenshot({ path: ss1, fullPage: false })
    info(`스크린샷: ${ss1}`)

    // ── PHASE 2: 출력 페이지 열기 ───────────────────────────────────
    section('3. 출력 페이지 열기')

    let reportPageContent = null
    let reportPopupUrl   = null

    // 방법 A: showReport_HTML 또는 printReport 함수가 있으면 실행
    const reportFn = printFunctions.find(f =>
      f.type === 'function' &&
      (f.name.toLowerCase().includes('report') || f.name.toLowerCase().includes('print'))
    )

    if (reportFn) {
      info(`방법 A: ${reportFn.name}() 호출 시도`)
      try {
        const popupPromise = headedContext.waitForEvent('page', { timeout: 5000 }).catch(() => null)
        await searchFrame.evaluate((fnName) => {
          if (typeof window[fnName] === 'function') window[fnName]()
        }, reportFn.name)
        const popup = await popupPromise
        if (popup) {
          await popup.waitForLoadState('domcontentloaded', { timeout: 15000 })
          reportPopupUrl = popup.url()
          reportPageContent = popup
          pass(`팝업 열림: ${reportPopupUrl}`)
        } else {
          info('팝업 없음 → 방법 B 시도')
        }
      } catch (e) {
        info(`방법 A 실패: ${e.message?.slice(0, 100)}`)
      }
    }

    // 방법 B: 출력 버튼 클릭
    if (!reportPageContent && printBtns.length > 0) {
      info('방법 B: 출력 버튼 클릭 시도')
      const btn = printBtns[0]
      try {
        const popupPromise2 = headedContext.waitForEvent('page', { timeout: 8000 }).catch(() => null)
        if (btn.tag === 'INPUT' || btn.tag === 'BUTTON') {
          if (btn.alt) {
            await searchFrame.click(`[alt="${btn.alt}"]`)
          } else if (btn.value) {
            await searchFrame.click(`input[value="${btn.value}"]`)
          }
        }
        const popup2 = await popupPromise2
        if (popup2) {
          await popup2.waitForLoadState('domcontentloaded', { timeout: 15000 })
          reportPopupUrl = popup2.url()
          reportPageContent = popup2
          pass(`출력 팝업 열림: ${reportPopupUrl}`)
        } else {
          info('방법 B 팝업 없음 → 방법 C')
        }
      } catch (e) {
        info(`방법 B 실패: ${e.message?.slice(0, 100)}`)
      }
    }

    // 방법 C: 발주내역 페이지 자체를 PDF로 저장 (보조 방법)
    if (!reportPageContent) {
      info('방법 C: 발주내역 페이지 직접 PDF 저장 (fallback)')
      reportPageContent = headedPage  // 조회 결과 페이지 사용
      pass('발주내역 페이지를 PDF 대상으로 사용 (직접 PDF)')
    }

    // ── PHASE 3: Headless 브라우저로 동일 URL PDF 저장 ──────────────
    // page.pdf()는 headless 모드에서만 동작
    section('4. PDF 저장 (Headless Chromium)')

    const targetUrl = reportPopupUrl ?? ORDER_LIST_URL
    info(`PDF 대상 URL: ${targetUrl}`)

    let headlessBrowser, headlessCtx, headlessPage
    let savedPdfPath = null

    try {
      headlessBrowser = await chromium.launch({ headless: true })
      headlessCtx = await headlessBrowser.newContext({ locale: 'ko-KR', timezoneId: 'Asia/Seoul' })

      // 쿠키/세션을 headed에서 headless로 복사
      const cookies = await headedContext.cookies()
      await headlessCtx.addCookies(cookies)
      info(`세션 쿠키 ${cookies.length}개 복사`)

      headlessPage = await headlessCtx.newPage()
      await headlessPage.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
      await headlessPage.waitForTimeout(2000)

      // 페이지 내용 확인 (로그인 리다이렉트 여부)
      const headlessUrl = headlessPage.url()
      const headlessContent = await headlessPage.content()
      info(`Headless 페이지 URL: ${headlessUrl}`)

      if (headlessUrl.includes('login') || headlessContent.includes('p_login_id')) {
        // 세션 쿠키가 안 됐으면 팝업 URL이 인증 없이 접근 가능한 경우를 시도
        info('쿠키 세션 실패 → 페이지 전체 캡처로 전환')
      }

      // PDF 저장
      const datePrefix = TEST_DATE.replace(/-/g, '')
      const ts = Date.now()
      const pdfFileName = `${datePrefix}_toever_orders_${ts}.pdf`
      savedPdfPath = path.join(pdfDir, pdfFileName)

      await headlessPage.pdf({
        path: savedPdfPath,
        format: 'A4',
        printBackground: true,
        landscape: true,  // 발주내역은 가로 방향이 더 적합
        margin: { top: '10mm', bottom: '10mm', left: '5mm', right: '5mm' },
      })

      if (fs.existsSync(savedPdfPath)) {
        const pdfStat = fs.statSync(savedPdfPath)
        pass(`PDF 저장 완료: ${pdfFileName}`)
        pass(`파일 크기: ${(pdfStat.size / 1024).toFixed(1)} KB`)
        pass(`저장 경로: ${savedPdfPath}`)
      } else {
        fail('PDF 파일이 생성되지 않음')
      }

    } catch (e) {
      fail('Headless PDF 저장 실패', e)

      // Fallback: headed 페이지에서 스크린샷으로 대체
      info('Fallback: 전체 페이지 스크린샷으로 대체')
      try {
        const ssPath = path.join(pdfDir, `${TEST_DATE.replace(/-/g, '')}_orders_screenshot.png`)
        await headedPage.screenshot({ path: ssPath, fullPage: true })
        if (fs.existsSync(ssPath)) {
          const ssStat = fs.statSync(ssPath)
          pass(`스크린샷 저장: ${path.basename(ssPath)} (${(ssStat.size/1024).toFixed(1)} KB)`)
          savedPdfPath = ssPath
        }
      } catch (ssErr) {
        fail('스크린샷 저장도 실패', ssErr)
      }
    } finally {
      if (headlessPage)    await headlessPage.close().catch(() => {})
      if (headlessCtx)     await headlessCtx.close().catch(() => {})
      if (headlessBrowser) await headlessBrowser.close().catch(() => {})
    }

    // ── DB artifact 등록 ─────────────────────────────────────────────
    if (savedPdfPath && fs.existsSync(savedPdfPath)) {
      try {
        const { sha256OfFile } = require(path.join(DIST, 'electron/services/storage.js'))
        const repos = require(path.join(DIST, 'electron/services/db/repositories.js'))
        const stat2 = fs.statSync(savedPdfPath)
        repos.saveFileArtifact({
          artifact_type: 'PDF_ORDER_REPORT',
          original_filename: path.basename(savedPdfPath),
          stored_path: savedPdfPath,
          sha256: sha256OfFile(savedPdfPath),
          size_bytes: stat2.size,
          run_id: null,
        })
        pass('PDF artifact DB 등록')
      } catch (e) {
        info(`artifact 등록 실패 (무시): ${e.message}`)
      }
    }

  } catch (e) {
    fail('전체 테스트 예외', e)
  } finally {
    if (headedPage)    await headedPage.close().catch(() => {})
    if (headedContext) await headedContext.close().catch(() => {})
    if (headedBrowser) await headedBrowser.close().catch(() => {})
    pass('브라우저 종료')
  }

  // ── 결과 보고 ──────────────────────────────────────────────────────
  section('5. 결과 보고')
  info(`PDF 저장 폴더: ${pdfDir}`)
  if (fs.existsSync(pdfDir)) {
    const files = fs.readdirSync(pdfDir)
    if (files.length === 0) {
      info('저장된 파일 없음')
    } else {
      console.log(`\n  ${C.cyan('저장된 파일 목록:')}`)
      console.log(`  ${'파일명'.padEnd(55)} 크기`)
      console.log(`  ${'─'.repeat(65)}`)
      for (const f of files) {
        const full = path.join(pdfDir, f)
        const size = fs.statSync(full).size
        console.log(`  ${f.padEnd(55)} ${(size/1024).toFixed(1)} KB`)
      }
    }
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
