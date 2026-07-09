import { chromium, Browser, BrowserContext, Page } from 'playwright'
import path from 'path'
import fs from 'fs'
import { screenshotPath, DIRS, sha256OfBuffer } from '../storage'
import { logToeverAction, saveFileArtifact, addManualReview } from '../db/repositories'

const TOEVER_BASE          = 'https://support.toever.co.kr'
const LOGIN_URL            = `${TOEVER_BASE}/Login/login.jsp`
const ORDER_LIST_URL       = `${TOEVER_BASE}/VendorMgr/PoState/orderDtlP.jsp`
// 실제 업로드 URL (탐색으로 확인: 2026-07-09)
// 구 URL /VendorMgr/PoState/uploadInvoice.jsp 는 404
const INVOICE_UPLOAD_URL   = `${TOEVER_BASE}/deliveryupload/deliveryListP.jsp`
const INVOICE_UPLOAD_ACTION = `${TOEVER_BASE}/deliveryupload/uploadOK.jsp`
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
  // ── 단 1회만 실행 (자동 재시도 없음) ─────────────────────────
  // 판별 기준 (uploadOK.jsp 실제 확인 기준 2026-07-09):
  //   성공>0  → SUCCESS
  //   성공=0, 스킵=0 → TOEVER_UPLOAD_NO_ROWS (실패, 재시도 없음)
  //   성공=0, 스킵>0 → 스킵 처리 (실패, 재시도 없음)
  //   오류 문구 있음  → FAIL (실패, 재시도 없음)
  //   파싱 불가       → UNCLEAR → manual_review_queue 등록
  try {
    // 실제 업로드 URL: /deliveryupload/deliveryListP.jsp
    // (구 URL /VendorMgr/PoState/uploadInvoice.jsp 는 404 — 2026-07-09 확인)
    await p.goto(INVOICE_UPLOAD_URL, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await p.waitForTimeout(2000)

    // deliveryListP.jsp 는 mainFrm 없이 단일 페이지로 로드됨
    const targetFrame = p.frame({ name: 'mainFrm' })
      ?? p.frames().find(f => f.url().includes('deliveryListP') || f.url().includes('deliveryupload'))
      ?? p

    // 파일 input 대기 (페이지 로드 확인)
    await targetFrame.waitForSelector('input#uploadFile', { timeout: 15000 })

    // UPLOAD_TOKEN 확인 (고정값 사용 금지)
    const tokenEl = await targetFrame.$('input[name="UPLOAD_TOKEN"]').catch(() => null)
    const token   = tokenEl
      ? await targetFrame.$eval('input[name="UPLOAD_TOKEN"]', (el: HTMLInputElement) => el.value).catch(() => '')
      : ''

    if (tokenEl && (!token || token.trim() === '')) {
      const tokenErrSs = await takeScreenshot(p, 'upload_token_missing')
      logToeverAction({
        run_id,
        action_type:    'INVOICE_UPLOAD',
        result_status:  'FAIL',
        result_message: 'UPLOAD_TOKEN이 없거나 비어있음',
        screenshot_path: tokenErrSs,
      })
      return { success: false, error: 'UPLOAD_TOKEN이 없거나 비어있습니다.', screenshotPath: tokenErrSs }
    }

    // 파일 첨부 (accept="application/vnd.ms-excel,.xls")
    await targetFrame.setInputFiles('input#uploadFile', invoiceFilePath)
    await p.waitForTimeout(500)

    const beforeSs = await takeScreenshot(p, 'invoice_upload_before')

    // Dry-run: uploadBtn 클릭 없이 종료
    if (dryRun) {
      logToeverAction({
        run_id,
        action_type:    'INVOICE_UPLOAD',
        target_url:     INVOICE_UPLOAD_URL,
        payload:        JSON.stringify({ filePath: invoiceFilePath, dryRun: true, token: (token ?? '').slice(0, 10) }),
        result_status:  'SKIP',
        result_message: 'DRY_RUN — uploadBtn 클릭 안 함',
        screenshot_path: beforeSs,
      })
      return { success: true, dryRun: true, resultMessage: 'DRY_RUN', screenshotPath: beforeSs }
    }

    // ── 업로드 버튼 클릭 (form action: uploadOK.jsp) ─────────────
    await Promise.all([
      p.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {}),
      targetFrame.click('input#uploadBtn'),
    ])
    await p.waitForTimeout(3000)

    const afterSs      = await takeScreenshot(p, 'invoice_upload_result')
    const resultContent = await p.content()

    // ── 결과 판별 ─────────────────────────────────────────────────
    // 1. 성공/스킵 건수 파싱
    const successMatch = resultContent.match(/성공=(\d+)/)
    const skipMatch    = resultContent.match(/스킵=(\d+)/)
    const successCount = successMatch ? parseInt(successMatch[1], 10) : null
    const skipCount    = skipMatch    ? parseInt(skipMatch[1],    10) : 0

    // 2. 오류 문구 감지 (빨간 글씨 / 오류 테이블 텍스트)
    const hasErrorText = resultContent.includes('오류') ||
                         resultContent.includes('실패') ||
                         resultContent.includes('ERROR') ||
                         resultContent.includes('error')

    let resultStatus: string
    let resultMessage: string
    let returnError:  string | undefined

    if (successCount === null) {
      // ── 케이스 6: 파싱 불가 → 결과 불명확 → manual_review_queue ──
      resultStatus  = 'UNCLEAR'
      resultMessage = '결과 파싱 불가 (성공=N 패턴 없음)'
      returnError   = '업로드 결과 불명확 — 수동검토 큐 등록'
      addManualReview({
        review_type:        'UPLOAD_PARTIAL_FAIL',
        severity:           'HIGH',
        run_id,
        error_message:      resultMessage,
        recommended_action: '투에버 송장업로드(uploadOK.jsp) 화면에서 처리 결과 직접 확인',
      })
    } else if (successCount > 0) {
      // ── 케이스 1: 성공 > 0 ────────────────────────────────────
      resultStatus  = 'SUCCESS'
      resultMessage = `성공=${successCount}, 스킵=${skipCount}`
    } else if (successCount === 0 && skipCount === 0) {
      // ── 케이스 4: 성공=0, 스킵=0 → 빈 파일 또는 전체 오류 ────
      resultStatus  = 'FAIL'
      resultMessage = 'TOEVER_UPLOAD_NO_ROWS: 성공=0, 스킵=0'
      returnError   = resultMessage
    } else {
      // ── 케이스 5: 성공=0, 스킵>0 → 전부 스킵 ─────────────────
      resultStatus  = 'SKIP'
      resultMessage = `성공=0, 스킵=${skipCount} (전체 스킵)`
      returnError   = resultMessage
    }

    // 오류/빨간 글씨 추가 기록 (케이스 5)
    if (hasErrorText && resultStatus !== 'FAIL') {
      const errTextSnippet = resultContent.match(/[가-힣\w\s]*오류[가-힣\w\s]*/)?.[0]?.slice(0, 100) ?? ''
      resultMessage += ` | 오류문구: ${errTextSnippet}`
    }

    logToeverAction({
      run_id,
      action_type:    'INVOICE_UPLOAD',
      target_url:     INVOICE_UPLOAD_URL,
      payload:        JSON.stringify({ filePath: invoiceFilePath, token: (token ?? '').slice(0, 10) + '...' }),
      result_status:  resultStatus,
      result_message: resultMessage,
      screenshot_path: afterSs,
    })

    if (resultStatus === 'SUCCESS') {
      return { success: true, resultMessage, screenshotPath: afterSs }
    }

    return { success: false, error: returnError ?? resultMessage, screenshotPath: afterSs }

  } catch (e) {
    const errSs = await takeScreenshot(p, 'invoice_upload_error').catch(() => '')
    logToeverAction({
      run_id,
      action_type:    'INVOICE_UPLOAD',
      result_status:  'ERROR',
      result_message: String(e),
      screenshot_path: errSs,
    })
    return { success: false, error: String(e), screenshotPath: errSs }
  }
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
 *  1. 발주내역 페이지에서 getReportCommonParams() 호출 → 발주번호(019001...) 범위 추출
 *  2. p_order_no가 발주번호(019 prefix) 형식인지 검증 — 주문번호(010 prefix)면 INVALID_ORDER_RANGE
 *  3. Headless 브라우저 + 쿠키로 rptSalePaperPrintP_HTML.jsp 접근
 *  4. OZ Viewer 로딩 완료 대기 (로딩 문구 소멸 폴링 + 3s 추가 대기)
 *  5. "조회된 데이터가 없습니다" 감지 시 PDF_OZ_NO_DATA skip
 *  6. page.pdf() 로 저장
 *  7. artifact DB 등록
 *
 * 발주번호 vs 주문번호:
 *  - pdf_order_no_from / pdf_order_no_to = 발주번호 (019001...) — OZ Viewer 전용
 *  - toever_order_no                     = 주문번호 (010001...) — 이지어드민/송장업로드 전용
 */
export async function savePdfReport(params: PdfReportParams): Promise<PdfReportResult> {
  const { context, dateFrom, dateTo, run_id } = params

  let headlessBrowser: Browser | null = null

  try {
    // ── Step 1: getReportCommonParams() 로 발주번호 범위 추출 ─────
    // 주의: 이 함수는 발주번호(019001...) 를 반환한다.
    //       toever_order_no(주문번호 010001...)를 절대 사용하지 않는다.
    const headedPage = context.pages().find(p => p.url().includes('orderDtlP')) ?? null

    let pdf_order_no_from: string | null = null
    let pdf_order_no_to:   string | null = null
    let reportUrl:         string | null = null

    if (headedPage) {
      // 1-A: getReportCommonParams() 직접 호출 (발주번호 기반 파라미터 전용)
      const commonParams = await headedPage.evaluate(() => {
        if (typeof (window as any).getReportCommonParams === 'function') {
          return (window as any).getReportCommonParams()
        }
        return null
      }).catch(() => null)

      if (commonParams?.p_order_no && commonParams?.p_order_noTo) {
        pdf_order_no_from = String(commonParams.p_order_no)
        pdf_order_no_to   = String(commonParams.p_order_noTo)

        const qs = new URLSearchParams({
          p_xml_file:     '/SALE/vendor_sale_paper_new.ozr',
          p_company_cd:   commonParams.p_company_cd  ?? '01',
          p_merchant_cd:  commonParams.p_merchant_cd ?? '0001',
          p_entr_no:      commonParams.p_entr_no     ?? '',
          p_order_dt:     dateFrom.replace(/-/g, ''),
          p_order_dtTo:   dateTo.replace(/-/g, ''),
          p_storeout_sts: commonParams.p_storeout_sts ?? '01',
          p_order_no:     pdf_order_no_from,
          p_order_noTo:   pdf_order_no_to,
        })
        reportUrl = `${REPORT_HTML_URL}?${qs.toString()}`
      }

      // 1-B: fallback — showReport_HTML() window.open 인터셉트
      if (!reportUrl) {
        const intercepted = await headedPage.evaluate(() => {
          return new Promise<string | null>(resolve => {
            const orig = window.open
            ;(window as any).open = (url: string) => {
              ;(window as any).open = orig
              resolve(url)
              return null
            }
            try {
              if (typeof (window as any).showReport_HTML === 'function') {
                ;(window as any).showReport_HTML()
              } else {
                resolve(null)
              }
            } catch {
              resolve(null)
            }
            setTimeout(() => { ;(window as any).open = orig; resolve(null) }, 1500)
          })
        }).catch(() => null)

        if (intercepted) {
          reportUrl = intercepted
          // intercepted URL에서 p_order_no 추출
          try {
            const iu = new URL(intercepted.startsWith('http') ? intercepted : TOEVER_BASE + intercepted)
            pdf_order_no_from = iu.searchParams.get('p_order_no')
            pdf_order_no_to   = iu.searchParams.get('p_order_noTo')
          } catch { /* 무시 */ }
        }
      }
    }

    if (!reportUrl || !pdf_order_no_from || !pdf_order_no_to) {
      const reason = '발주내역 페이지에서 발주번호 범위를 추출하지 못했습니다. (조회 결과가 없거나 페이지가 닫힘)'
      logToeverAction({
        run_id, action_type: 'PDF_REPORT', target_url: REPORT_HTML_URL,
        result_status: 'SKIP', result_message: 'PDF_SKIPPED_NO_ORDER_RANGE',
      })
      return { success: false, skipped: true, skip_reason: reason }
    }

    // ── Step 2: 발주번호 형식 검증 ───────────────────────────────
    // 발주번호: 019001... 로 시작
    // 주문번호: 010001... 로 시작 — OZ Viewer에 사용 금지
    const isPoBandNo = (v: string) => /^0[1-9]\d{17,}$/.test(v) && !v.startsWith('010')

    if (!isPoBandNo(pdf_order_no_from) || !isPoBandNo(pdf_order_no_to)) {
      const reason =
        `PDF_REPORT_INVALID_ORDER_RANGE: p_order_no="${pdf_order_no_from}" p_order_noTo="${pdf_order_no_to}"` +
        ' — 주문번호(010001...)가 발주번호 자리에 잘못 들어갔거나 형식 불일치'
      logToeverAction({
        run_id, action_type: 'PDF_REPORT', target_url: REPORT_HTML_URL,
        result_status: 'SKIP', result_message: reason,
      })
      return { success: false, skipped: true, skip_reason: reason }
    }

    // URL이 상대경로면 BASE 추가
    if (!reportUrl.startsWith('http')) {
      reportUrl = TOEVER_BASE + (reportUrl.startsWith('/') ? reportUrl : '/' + reportUrl)
    }

    // ── Step 3: 쿠키 복사 + Headless 브라우저 실행 ───────────────
    const cookies = await context.cookies()

    headlessBrowser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    })
    const headlessCtx = await headlessBrowser.newContext({ locale: 'ko-KR', timezoneId: 'Asia/Seoul' })
    await headlessCtx.addCookies(cookies)
    const headlessPage = await headlessCtx.newPage()

    // 출력 URL 접근 (GET 요청 — 상태 변경 없음)
    await headlessPage.goto(reportUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })

    // ── Step 4: OZ Viewer 로딩 완료 대기 ────────────────────────
    // 로딩 중 화면을 PDF로 저장하면 "오즈 리포트 뷰어를 실행하고 있습니다" 내용만 찍힘
    const OZ_LOADING_TEXTS = [
      '오즈 리포트 뷰어를 실행하고 있습니다',
      '데이터 모듈을 받기 시작합니다',
      '데이터 모듈을 받고 있습니다',
    ]
    const OZ_NO_DATA_TEXT = '조회된 데이터가 없습니다'

    const OZ_LOAD_MAX_MS  = 35000
    const OZ_POLL_MS      = 2000
    let ozLoadElapsed     = 0
    let ozLoadingDone     = false

    while (ozLoadElapsed < OZ_LOAD_MAX_MS) {
      await headlessPage.waitForTimeout(OZ_POLL_MS)
      ozLoadElapsed += OZ_POLL_MS

      const bodyText = await headlessPage.evaluate(() =>
        document.body?.innerText ?? ''
      ).catch(() => '')

      const stillLoading = OZ_LOADING_TEXTS.some(t => bodyText.includes(t))
      if (!stillLoading) {
        ozLoadingDone = true
        // 로딩 문구 사라진 후 3초 추가 대기 (렌더링 완료)
        await headlessPage.waitForTimeout(3000)
        break
      }
    }

    // 로딩 완료 후 본문 확인
    const finalBodyText = await headlessPage.evaluate(() =>
      document.body?.innerText ?? ''
    ).catch(() => '')

    const finalUrl = headlessPage.url()
    const pageContent = await headlessPage.content()

    // 로그인 리다이렉트 감지
    if (finalUrl.includes('login') || finalUrl.includes('Login') || pageContent.includes('p_login_id')) {
      const errSs = await headlessPage.screenshot({ path: screenshotPath('pdf_session_expired') }).catch(() => '')
      return { success: false, error: '출력 페이지 접근 시 로그인 리다이렉트 (세션 만료)', screenshotPath: errSs as string }
    }

    // OZ "조회된 데이터가 없습니다" 감지 → PDF 저장 건너뜀
    if (finalBodyText.includes(OZ_NO_DATA_TEXT)) {
      const ss = await headlessPage.screenshot({ path: screenshotPath('pdf_oz_no_data') }).catch(() => '') as string
      logToeverAction({
        run_id, action_type: 'PDF_REPORT', target_url: reportUrl,
        result_status: 'SKIP', result_message: `PDF_OZ_NO_DATA (p_order_no=${pdf_order_no_from})`,
        screenshot_path: ss,
      })
      return { success: false, skipped: true, skip_reason: `OZ Viewer 조회 결과 없음 (발주번호 범위: ${pdf_order_no_from}~${pdf_order_no_to})` }
    }

    // 타임아웃 후에도 로딩 문구가 남아있으면 경고 (PDF는 일단 시도)
    if (!ozLoadingDone) {
      logToeverAction({
        run_id, action_type: 'PDF_REPORT', target_url: reportUrl,
        result_status: 'WARN', result_message: `OZ Viewer 로딩 타임아웃(${OZ_LOAD_MAX_MS}ms) — page.pdf() 강행`,
      })
    }

    // PDF 저장 경로
    const pdfDir = DIRS.pdfContracts()
    if (!fs.existsSync(pdfDir)) fs.mkdirSync(pdfDir, { recursive: true })

    const datePfx   = dateFrom.replace(/-/g, '')
    const runSuffix = run_id != null ? `_run${run_id}` : `_${Date.now()}`
    const filename  = `${datePfx}_report${runSuffix}.pdf`
    const filePath  = path.join(pdfDir, filename)

    // ── Step 5: PDF 저장 ─────────────────────────────────────────
    await headlessPage.pdf({
      path:            filePath,
      format:          'A4',
      printBackground: true,
      landscape:       true,
      margin: { top: '8mm', bottom: '8mm', left: '5mm', right: '5mm' },
    })

    // ── Step 6: 파일 크기 확인 ───────────────────────────────────
    if (!fs.existsSync(filePath)) {
      return { success: false, error: 'PDF 파일이 생성되지 않았습니다.' }
    }
    const stat = fs.statSync(filePath)
    if (stat.size === 0) {
      fs.unlinkSync(filePath)
      const errSs = await headlessPage.screenshot({ path: screenshotPath('pdf_empty') }).catch(() => '')
      return { success: false, error: 'PDF 파일이 0바이트입니다. (렌더링 실패)', screenshotPath: errSs as string }
    }

    // ── Step 7: artifact DB 등록 ─────────────────────────────────
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

    // ── Step 8: 성공 로그 ────────────────────────────────────────
    logToeverAction({
      run_id,
      action_type:    'PDF_REPORT',
      target_url:     reportUrl ?? REPORT_HTML_URL,
      result_status:  'SUCCESS',
      result_message: `${filename} (${(stat.size / 1024).toFixed(1)} KB) po=${pdf_order_no_from}~${pdf_order_no_to}`,
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
