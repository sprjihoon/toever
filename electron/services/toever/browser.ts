import { chromium, Browser, BrowserContext, Page } from 'playwright'
import path from 'path'
import fs from 'fs'
import { screenshotPath, DIRS, sha256OfBuffer } from '../storage'
import { logToeverAction, saveFileArtifact, addManualReview } from '../db/repositories'

const TOEVER_BASE          = 'https://support.toever.co.kr'
const LOGIN_URL            = `${TOEVER_BASE}/Login/login.jsp`
const ORDER_LIST_URL       = `${TOEVER_BASE}/VendorMgr/PoState/orderDtlP.jsp`
const INVOICE_UPLOAD_URL   = `${TOEVER_BASE}/VendorMgr/PoState/uploadInvoice.jsp`
const REPORT_HTML_URL      = `${TOEVER_BASE}/VendorMgr/PoState/rptSalePaperPrintP_HTML.jsp`

// 로그인 실패 문자열
const LOGIN_FAIL_MESSAGES  = [
  '로그인 ID를 입력하세요',
  '비밀번호를 입력하세요',
  '계정이 잠겼습니다',
  '인증을 5회 실패',
  '아이디 또는 비밀번호',
]

let browser: Browser | null = null
let context: BrowserContext | null = null
let page: Page | null = null

export interface BrowserSession {
  page: Page
  context: BrowserContext
}

export async function launchBrowser(downloadDir: string): Promise<BrowserSession> {
  const dir = DIRS.logsScreenshots()
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

  browser = await chromium.launch({
    headless: false,   // 운영자가 볼 수 있게 non-headless
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  })

  context = await browser.newContext({
    acceptDownloads: true,
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
  })

  // 다운로드 경로 설정
  await context.route('**/*', route => route.continue())

  page = await context.newPage()

  return { page, context }
}

export async function closeBrowser(): Promise<void> {
  if (page) { try { await page.close() } catch { /* ignore */ } }
  if (context) { try { await context.close() } catch { /* ignore */ } }
  if (browser) { try { await browser.close() } catch { /* ignore */ } }
  browser = null
  context = null
  page = null
}

export async function takeScreenshot(p: Page, label: string): Promise<string> {
  const dest = screenshotPath(label)
  await p.screenshot({ path: dest, fullPage: true })
  return dest
}

/**
 * 현재 투에버 로그인 세션이 유효한지 확인한다.
 * 이미 로그인되어 있으면 재로그인하지 않는다.
 */
export async function checkLoginSession(p: Page): Promise<boolean> {
  try {
    // 발주내역 페이지로 직접 접속 시도
    await p.goto(ORDER_LIST_URL, { waitUntil: 'domcontentloaded', timeout: 20000 })
    await p.waitForTimeout(1500)

    const url = p.url()
    const content = await p.content()

    // 로그인 페이지로 리다이렉트되었으면 세션 만료
    if (url.includes('login') || url.includes('Login')) return false
    if (content.includes('loginAction') || content.includes('p_login_id')) return false

    // 발주내역 화면 확인
    if (content.includes('발주내역') || content.includes('orderDtlP')) return true

    return false
  } catch {
    return false
  }
}

/**
 * 투에버 로그인
 *
 * 1. 현재 세션 유효성 먼저 확인
 * 2. 세션이 유효하면 재로그인 없이 성공 반환
 * 3. 세션이 없으면 로그인 시도 (최대 1회 재시도)
 * 4. 로그인 실패 시 스크린샷/로그 저장 후 중단 (계정 잠금 방지)
 */
export async function loginToever(
  p: Page,
  id: string,
  password: string,
  run_id?: number
): Promise<{ success: boolean; error?: string; screenshotPath?: string; sessionReused?: boolean }> {
  // 먼저 세션 확인
  const sessionValid = await checkLoginSession(p)
  if (sessionValid) {
    logToeverAction({ run_id, action_type: 'LOGIN_CHECK', target_url: ORDER_LIST_URL, result_status: 'SESSION_REUSED' })
    return { success: true, sessionReused: true }
  }

  // 로그인 시도 (최대 1회 재시도)
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await p.goto(TOEVER_BASE, { waitUntil: 'domcontentloaded', timeout: 30000 })
      await p.waitForTimeout(1500)

      // frameset 구조 - mainFrm 프레임 접근
      const mainFrame =
        p.frame({ name: 'mainFrm' }) ??
        p.frame({ url: /login\.jsp/i }) ??
        p

      await mainFrame.waitForSelector('input[name="p_login_id"]', { timeout: 15000 })
      await mainFrame.fill('input[name="p_login_id"]', id)
      await mainFrame.fill('input[name="p_password"]', password)

      await takeScreenshot(p, `before_login_attempt${attempt}`)

      // 로그인 버튼 클릭
      await Promise.all([
        mainFrame.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => {}),
        mainFrame.click('input[type="image"][alt="로그인"]'),
      ])
      await p.waitForTimeout(2000)

      const pageContent = await p.content()

      // 계정 잠김 감지 → 즉시 중단 (재시도 금지)
      if (pageContent.includes('계정이 잠겼습니다') || pageContent.includes('5회 실패')) {
        const errSs = await takeScreenshot(p, 'login_account_locked')
        const errMsg = '계정이 잠겼습니다. 관리자에게 문의하세요.'
        logToeverAction({ run_id, action_type: 'LOGIN', target_url: TOEVER_BASE, result_status: 'LOCKED', result_message: errMsg, screenshot_path: errSs })
        return { success: false, error: errMsg, screenshotPath: errSs }
      }

      // 일반 로그인 실패 확인
      let failMsg: string | null = null
      for (const msg of LOGIN_FAIL_MESSAGES) {
        if (pageContent.includes(msg)) { failMsg = msg; break }
      }

      if (failMsg) {
        const errSs = await takeScreenshot(p, `login_failed_attempt${attempt}`)
        logToeverAction({ run_id, action_type: 'LOGIN', target_url: TOEVER_BASE, result_status: 'FAIL', result_message: failMsg, screenshot_path: errSs })

        if (attempt === 2) {
          // 2회 시도 완료 → 중단
          return { success: false, error: `로그인 실패 (2회 시도): ${failMsg}`, screenshotPath: errSs }
        }
        // 1회 더 시도
        await p.waitForTimeout(2000)
        continue
      }

      // 로그인 성공 확인
      const successSs = await takeScreenshot(p, 'login_success')
      logToeverAction({ run_id, action_type: 'LOGIN', target_url: TOEVER_BASE, result_status: 'SUCCESS', screenshot_path: successSs })
      return { success: true, screenshotPath: successSs }

    } catch (e) {
      if (attempt === 2) {
        const errSs = await takeScreenshot(p, 'login_error').catch(() => '')
        logToeverAction({ run_id, action_type: 'LOGIN', target_url: TOEVER_BASE, result_status: 'ERROR', result_message: String(e), screenshot_path: errSs })
        return { success: false, error: String(e), screenshotPath: errSs }
      }
    }
  }

  return { success: false, error: '로그인 실패' }
}

/**
 * 투에버 발주내역 조회 및 엑셀 다운로드
 */
export async function downloadToeverOrders(
  p: Page,
  dateFrom: string,  // YYYY-MM-DD
  dateTo: string,    // YYYY-MM-DD
  downloadDir: string,
  run_id?: number
): Promise<{ success: boolean; filePath?: string; error?: string }> {
  try {
    await p.goto(ORDER_LIST_URL, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await p.waitForTimeout(2000)

    const targetFrame = p.frame({ name: 'mainFrm' }) ?? p.frame({ url: /orderDtlP/ }) ?? p

    await targetFrame.waitForSelector('input[name="order_dt_from"]', { timeout: 15000 })

    // 날짜 입력
    const dateFromHidden = dateFrom.replace(/-/g, '')  // YYYYMMDD
    const dateToHidden = dateTo.replace(/-/g, '')

    await targetFrame.fill('input[name="order_dt_from"]', dateFrom)
    await targetFrame.fill('input[name="order_dt_to"]', dateTo)

    // hidden input도 설정
    await targetFrame.evaluate((data) => {
      const fromHidden = document.querySelector<HTMLInputElement>('input[name="p_order_dt_from"]')
      const toHidden = document.querySelector<HTMLInputElement>('input[name="p_order_dt_to"]')
      if (fromHidden) fromHidden.value = data.from
      if (toHidden) toHidden.value = data.to
    }, { from: dateFromHidden, to: dateToHidden })

    const ssSrc = await takeScreenshot(p, 'before_search')

    // 조회 버튼 클릭
    await Promise.all([
      targetFrame.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {}),
      targetFrame.click('input[type="image"][alt="조회"]'),
    ])
    await p.waitForTimeout(3000)

    await takeScreenshot(p, 'after_search')

    // 엑셀 다운로드
    if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir, { recursive: true })

    const [download] = await Promise.all([
      p.waitForEvent('download', { timeout: 30000 }),
      targetFrame.evaluate(() => {
        if (typeof (window as any).downCvs_spring === 'function') {
          (window as any).downCvs_spring()
        }
      }).catch(async () => {
        // 버튼 클릭 fallback
        const imgEl = await targetFrame.$('img[alt="엑셀 파일을 다운로드합니다."]')
        if (imgEl) await imgEl.click()
      }),
    ])

    const ts = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 17)
    const suggestedName = download.suggestedFilename() || `toever_orders_${ts}.xls`
    const savedPath = path.join(downloadDir, suggestedName)
    await download.saveAs(savedPath)

    const dlSs = await takeScreenshot(p, 'after_download')
    logToeverAction({
      run_id,
      action_type: 'DOWNLOAD_ORDERS',
      target_url: ORDER_LIST_URL,
      payload: JSON.stringify({ dateFrom, dateTo }),
      result_status: 'SUCCESS',
      result_message: savedPath,
      screenshot_path: dlSs,
    })

    return { success: true, filePath: savedPath }
  } catch (e) {
    const errSs = await takeScreenshot(p, 'download_error').catch(() => '')
    logToeverAction({
      run_id,
      action_type: 'DOWNLOAD_ORDERS',
      target_url: ORDER_LIST_URL,
      result_status: 'ERROR',
      result_message: String(e),
      screenshot_path: errSs,
    })
    return { success: false, error: String(e) }
  }
}

/**
 * 투에버 송장 파일 업로드
 * - UPLOAD_TOKEN은 반드시 페이지에서 읽어서 사용 (고정값 금지)
 * - 상태 변경 작업이므로 재시도 최대 1회
 * - dryRun=true: 파일 첨부까지만, uploadBtn 클릭 안 함
 */
export async function uploadToeverInvoice(
  p: Page,
  invoiceFilePath: string,
  run_id?: number,
  dryRun = false,
): Promise<{
  success: boolean
  dryRun?: boolean
  resultMessage?: string
  screenshotPath?: string
  error?: string
}> {
  const MAX_ATTEMPTS = dryRun ? 1 : 2

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await p.goto(INVOICE_UPLOAD_URL, { waitUntil: 'domcontentloaded', timeout: 30000 })
      await p.waitForTimeout(2000)

      const targetFrame = p.frame({ name: 'mainFrm' }) ?? p

      // UPLOAD_TOKEN 확인 (고정값 사용 금지)
      await targetFrame.waitForSelector('input[name="UPLOAD_TOKEN"]', { timeout: 15000 })
      const token = await targetFrame.$eval(
        'input[name="UPLOAD_TOKEN"]',
        (el: HTMLInputElement) => el.value
      )

      if (!token || token.trim() === '') {
        const tokenErrSs = await takeScreenshot(p, 'upload_token_missing')
        logToeverAction({
          run_id,
          action_type: 'INVOICE_UPLOAD',
          result_status: 'FAIL',
          result_message: 'UPLOAD_TOKEN이 없거나 비어있음',
          screenshot_path: tokenErrSs,
        })
        return {
          success: false,
          error: 'UPLOAD_TOKEN이 없거나 비어있습니다.',
          screenshotPath: tokenErrSs,
        }
      }

      // 파일 첨부
      await targetFrame.setInputFiles('input#uploadFile', invoiceFilePath)
      await p.waitForTimeout(500)

      const beforeSs = await takeScreenshot(p, `invoice_upload_attempt${attempt}_before`)

      // Dry-run: uploadBtn 클릭 없이 여기서 종료
      if (dryRun) {
        logToeverAction({
          run_id,
          action_type: 'INVOICE_UPLOAD',
          target_url: INVOICE_UPLOAD_URL,
          payload: JSON.stringify({ filePath: invoiceFilePath, dryRun: true }),
          result_status: 'SKIP',
          result_message: 'DRY_RUN — uploadBtn 클릭 안 함',
          screenshot_path: beforeSs,
        })
        return { success: true, dryRun: true, resultMessage: 'DRY_RUN', screenshotPath: beforeSs }
      }

      // 업로드 버튼 클릭
      await Promise.all([
        targetFrame.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {}),
        targetFrame.click('input#uploadBtn'),
      ])

      await p.waitForTimeout(3000)
      const afterSs = await takeScreenshot(p, `invoice_upload_attempt${attempt}_result`)

      const resultContent = await p.content()
      // 성공 판별: 구체적 성공 메시지 포함 AND 실패/오류 메시지 미포함
      const hasSuccessSign = resultContent.includes('업로드 완료') ||
        resultContent.includes('등록 완료') ||
        resultContent.includes('성공적으로') ||
        resultContent.includes('처리 완료') ||
        resultContent.includes('건 처리')
      const hasFailSign = resultContent.includes('실패') ||
        resultContent.includes('오류') ||
        resultContent.includes('error') ||
        resultContent.includes('ERROR')
      const isSuccess = hasSuccessSign && !hasFailSign

      logToeverAction({
        run_id,
        action_type: 'INVOICE_UPLOAD',
        target_url: INVOICE_UPLOAD_URL,
        payload: JSON.stringify({ filePath: invoiceFilePath, token: token.slice(0, 10) + '...' }),
        result_status: isSuccess ? 'SUCCESS' : 'FAIL',
        result_message: `attempt=${attempt}`,
        screenshot_path: afterSs,
      })

      if (isSuccess) {
        return { success: true, resultMessage: '업로드 완료', screenshotPath: afterSs }
      }

      if (attempt >= MAX_ATTEMPTS) {
        return {
          success: false,
          error: '업로드 실패 (결과 불명확)',
          screenshotPath: afterSs,
        }
      }

      // 1회 재시도 전 대기
      await p.waitForTimeout(3000)
    } catch (e) {
      const errSs = await takeScreenshot(p, `invoice_upload_error_attempt${attempt}`).catch(() => '')
      if (attempt >= MAX_ATTEMPTS) {
        logToeverAction({
          run_id,
          action_type: 'INVOICE_UPLOAD',
          result_status: 'ERROR',
          result_message: String(e),
          screenshot_path: errSs,
        })
        return { success: false, error: String(e), screenshotPath: errSs }
      }
    }
  }

  return { success: false, error: '최대 재시도 초과' }
}

/**
 * 출고작업지시 처리
 * - 실제 체크박스 클릭 방식 사용
 * - dryRun=true: 체크박스 선택/submit 없이 대상 발주번호 목록만 반환
 * - 자동 재시도 금지
 * - 결과 불명확 시 수동검토 큐 등록
 */
export async function processStoreoutInstruction(
  p: Page,
  poNos: string[],
  run_id?: number,
  dryRun = false,
): Promise<{
  success: boolean
  dryRun?: boolean
  processedPoNos: string[]
  failedPoNos: string[]
  unclearPoNos: string[]
  screenshotPath?: string
  error?: string
}> {
  try {
    await p.goto(ORDER_LIST_URL, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await p.waitForTimeout(2000)

    const targetFrame = p.frame({ name: 'mainFrm' }) ?? p

    // 출고작업지시 대상 체크박스 찾기
    const checkboxes = await targetFrame.$$('input[name="selected_order_key_chk"]')
    const processedPoNos: string[] = []
    const failedPoNos: string[] = []
    const unclearPoNos: string[] = []

    for (const checkbox of checkboxes) {
      const value = await checkbox.getAttribute('value') ?? ''
      // value 예시: 01||9001||20260708||00001||0190012026070800001||00309599
      const parts = value.split('||')
      const poNo = parts[4] ?? ''  // 인덱스 4 = 발주번호

      if (poNos.includes(poNo)) {
        if (!dryRun) await checkbox.click()
        processedPoNos.push(poNo)
      }
    }

    if (processedPoNos.length === 0) {
      return {
        success: false,
        dryRun,
        processedPoNos: [],
        failedPoNos: poNos,
        unclearPoNos: [],
        error: '체크박스에서 발주번호를 찾지 못했습니다.',
      }
    }

    // Dry-run: 체크박스 클릭/submit 없이 대상 목록만 반환
    if (dryRun) {
      const beforeSs = await takeScreenshot(p, 'storeout_dryrun_preview')
      logToeverAction({
        run_id,
        action_type: 'STOREOUT_INSTRUCT',
        target_url: ORDER_LIST_URL,
        payload: JSON.stringify({ poNos: processedPoNos, dryRun: true }),
        result_status: 'SKIP',
        result_message: `DRY_RUN — ${processedPoNos.length}건 대상 확인, submit 안 함`,
        screenshot_path: beforeSs,
      })
      return {
        success: true,
        dryRun: true,
        processedPoNos,
        failedPoNos: poNos.filter(p => !processedPoNos.includes(p)),
        unclearPoNos: [],
        screenshotPath: beforeSs,
      }
    }

    const beforeSs = await takeScreenshot(p, 'storeout_before_submit')

    // 출고작업지시 submit
    const dialogPromise = p.waitForEvent('dialog', { timeout: 5000 }).catch(() => null)
    await targetFrame.evaluate(() => {
      if (typeof (window as any).submitSelectedOrders === 'function') {
        (window as any).submitSelectedOrders()
      }
    })

    const dialog = await dialogPromise
    if (dialog) {
      await dialog.accept()
    }

    await p.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})
    await p.waitForTimeout(3000)

    const afterSs = await takeScreenshot(p, 'storeout_after_submit')
    const resultContent = await p.content()

    const isSuccess = resultContent.includes('처리') && !resultContent.includes('오류') && !resultContent.includes('실패')
    const isUnclear = !isSuccess && !resultContent.includes('오류')

    if (isUnclear) {
      unclearPoNos.push(...processedPoNos)
      // 자동 재시도 금지 — 수동검토 큐에 등록
      addManualReview({
        review_type: 'STOREOUT_UNCLEAR',
        severity: 'HIGH',
        run_id,
        error_message: `출고작업지시 결과 불명확: ${processedPoNos.join(', ')}`,
        recommended_action: '투에버 발주내역 화면에서 출고작업지시 상태 수동 확인 후 처리',
      })
    }

    logToeverAction({
      run_id,
      action_type: 'STOREOUT_INSTRUCT',
      target_url: ORDER_LIST_URL,
      payload: JSON.stringify({ poNos: processedPoNos }),
      result_status: isSuccess ? 'SUCCESS' : isUnclear ? 'UNCLEAR' : 'FAIL',
      screenshot_path: afterSs,
    })

    return {
      success: isSuccess,
      processedPoNos,
      failedPoNos,
      unclearPoNos,
      screenshotPath: afterSs,
    }
  } catch (e) {
    const errSs = await takeScreenshot(p, 'storeout_error').catch(() => '')
    return {
      success: false,
      processedPoNos: [],
      failedPoNos: poNos,
      unclearPoNos: [],
      error: String(e),
      screenshotPath: errSs,
    }
  }
}

export { TOEVER_BASE, ORDER_LIST_URL, INVOICE_UPLOAD_URL }

// ============================================================
// PDF 출력 저장
//
// 안전 조건:
// - GET 요청 + page.pdf() 만 수행 (상태 변경 없음)
// - 송장업로드 / 출고작업지시 / form submit 금지
// - 실패해도 주문 import/엑셀 생성 흐름 중단 안 함
// ============================================================

export interface PdfReportParams {
  /** 현재 로그인된 Headed 브라우저 context (쿠키 원본) */
  context:  BrowserContext
  /** 조회 시작일 YYYY-MM-DD */
  dateFrom: string
  /** 조회 종료일 YYYY-MM-DD */
  dateTo:   string
  run_id?:  number
}

export interface PdfReportResult {
  success:        boolean
  filePath?:      string
  size_bytes?:    number
  skipped?:       boolean
  skip_reason?:   string
  screenshotPath?: string
  error?:         string
}

/**
 * 투에버 발주내역 출력 페이지를 PDF로 저장한다.
 *
 * 흐름:
 *  1. 로그인된 context 에서 쿠키 복사
 *  2. 발주내역 페이지에서 getReportCommonParams() 호출 → p_order_no/p_order_noTo 추출
 *  3. Headless 브라우저 + 복사된 쿠키로 rptSalePaperPrintP_HTML.jsp 접근
 *  4. page.pdf() 로 저장
 *  5. artifact DB 등록
 */
export async function savePdfReport(params: PdfReportParams): Promise<PdfReportResult> {
  const { context, dateFrom, dateTo, run_id } = params

  let headlessBrowser: Browser | null = null

  try {
    // ── Step 1: 발주내역 페이지에서 report 파라미터 추출 ──────────
    //   window.open 을 가로채서 실제 URL 캡처 (조회 결과 기반 동적 파라미터)
    const headedPage = context.pages().find(p => p.url().includes('orderDtlP')) ?? null

    let reportUrl: string | null = null

    if (headedPage) {
      reportUrl = await headedPage.evaluate(() => {
        let captured: string | null = null
        const origOpen = window.open.bind(window)
        // window.open 을 일시적으로 가로채기 (창 안 열고 URL만 캡처)
        ;(window as any).open = (url: string) => { captured = url; return null }
        try {
          if (typeof (window as any).showReport_HTML === 'function') {
            ;(window as any).showReport_HTML()
          }
        } catch { /* 무시 */ }
        ;(window as any).open = origOpen
        return captured
      }).catch(() => null)
    }

    // 동적 추출 실패 시 → 발주내역 페이지에서 직접 파라미터 수집
    if (!reportUrl) {
      if (headedPage) {
        const p = await headedPage.evaluate(() => {
          if (typeof (window as any).getReportCommonParams === 'function') {
            return (window as any).getReportCommonParams()
          }
          return null
        }).catch(() => null)

        if (p && p.p_order_no && p.p_order_noTo) {
          const qs = new URLSearchParams({
            p_xml_file:     '/SALE/vendor_sale_paper_new.ozr',
            p_company_cd:   p.p_company_cd  ?? '01',
            p_merchant_cd:  p.p_merchant_cd ?? '0001',
            p_entr_no:      p.p_entr_no     ?? '',
            p_order_dt:     dateFrom.replace(/-/g, ''),
            p_order_dtTo:   dateTo.replace(/-/g, ''),
            p_storeout_sts: p.p_storeout_sts ?? '01',
            p_order_no:     p.p_order_no,
            p_order_noTo:   p.p_order_noTo,
          })
          reportUrl = `${REPORT_HTML_URL}?${qs.toString()}`
        }
      }
    }

    if (!reportUrl) {
      const reason = '발주내역 페이지에서 발주번호 범위를 추출하지 못했습니다. (조회 결과가 없거나 페이지가 닫힘)'
      logToeverAction({
        run_id,
        action_type: 'PDF_REPORT',
        target_url:  REPORT_HTML_URL,
        result_status: 'SKIP',
        result_message: 'PDF_SKIPPED_NO_ORDER_RANGE',
      })
      return { success: false, skipped: true, skip_reason: reason }
    }

    // URL이 절대경로가 아니면 BASE 추가
    if (!reportUrl.startsWith('http')) {
      reportUrl = TOEVER_BASE + (reportUrl.startsWith('/') ? reportUrl : '/' + reportUrl)
    }

    // ── Step 2: 쿠키 복사 ────────────────────────────────────────
    const cookies = await context.cookies()

    // ── Step 3: Headless 브라우저로 PDF 저장 ─────────────────────
    headlessBrowser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    })

    const headlessCtx = await headlessBrowser.newContext({
      locale:     'ko-KR',
      timezoneId: 'Asia/Seoul',
    })
    await headlessCtx.addCookies(cookies)

    const headlessPage = await headlessCtx.newPage()

    // 출력 URL 접근 (GET 요청 — 상태 변경 없음)
    await headlessPage.goto(reportUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })

    // 네트워크 안정화 대기 (최대 10초)
    await headlessPage.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {})
    await headlessPage.waitForTimeout(1500)  // 렌더링 여유

    // 로그인 리다이렉트 감지
    const finalUrl = headlessPage.url()
    const pageContent = await headlessPage.content()
    if (finalUrl.includes('login') || finalUrl.includes('Login') || pageContent.includes('p_login_id')) {
      const errSs = await headlessPage.screenshot({ path: screenshotPath('pdf_session_expired') }).catch(() => '')
      return {
        success: false,
        error: '출력 페이지 접근 시 로그인 리다이렉트 (세션 만료)',
        screenshotPath: errSs as string,
      }
    }

    // PDF 저장 경로
    const pdfDir = DIRS.pdfContracts()
    if (!fs.existsSync(pdfDir)) fs.mkdirSync(pdfDir, { recursive: true })

    const datePfx = dateFrom.replace(/-/g, '')
    const ts      = Date.now()
    const runSuffix = run_id != null ? `_run${run_id}` : `_${ts}`
    const filename  = `${datePfx}_report${runSuffix}.pdf`
    const filePath  = path.join(pdfDir, filename)

    // ── Step 4: PDF 저장 ─────────────────────────────────────────
    await headlessPage.pdf({
      path:            filePath,
      format:          'A4',
      printBackground: true,
      landscape:       true,
      margin: { top: '8mm', bottom: '8mm', left: '5mm', right: '5mm' },
    })

    // ── Step 5: 파일 크기 확인 ───────────────────────────────────
    if (!fs.existsSync(filePath)) {
      return { success: false, error: 'PDF 파일이 생성되지 않았습니다.' }
    }
    const stat = fs.statSync(filePath)
    if (stat.size === 0) {
      fs.unlinkSync(filePath)  // 0바이트 파일 삭제
      const errSs = await headlessPage.screenshot({ path: screenshotPath('pdf_empty') }).catch(() => '')
      return {
        success: false,
        error: 'PDF 파일이 0바이트입니다. (렌더링 실패)',
        screenshotPath: errSs as string,
      }
    }

    // ── Step 6: artifact DB 등록 ─────────────────────────────────
    try {
      const buf = fs.readFileSync(filePath)
      saveFileArtifact({
        artifact_type:    'TOEVER_ORDER_PDF',
        original_filename: filename,
        stored_path:      filePath,
        sha256:           sha256OfBuffer(buf),
        size_bytes:       stat.size,
        run_id:           run_id ?? null,
      })
    } catch { /* artifact 등록 실패는 무시 */ }

    // ── Step 7: 성공 로그 ────────────────────────────────────────
    logToeverAction({
      run_id,
      action_type:    'PDF_REPORT',
      target_url:     reportUrl,
      result_status:  'SUCCESS',
      result_message: `${filename} (${(stat.size / 1024).toFixed(1)} KB)`,
    })

    return { success: true, filePath, size_bytes: stat.size }

  } catch (e) {
    // ── 실패 처리 (경고 로그만 — 흐름 중단 안 함) ────────────────
    const errMsg = String(e)
    let errSs = ''
    try {
      errSs = screenshotPath('pdf_report_error')
      // headless page가 이미 닫혔을 수 있으므로 무시
    } catch { /* 무시 */ }

    logToeverAction({
      run_id,
      action_type:    'PDF_REPORT',
      target_url:     REPORT_HTML_URL,
      result_status:  'ERROR',
      result_message: errMsg,
      screenshot_path: errSs,
    })

    return { success: false, error: errMsg }
  } finally {
    if (headlessBrowser) {
      await headlessBrowser.close().catch(() => {})
    }
  }
}
