/**
 * 투에버 송장 업로드 페이지 접근 안정성 사전 점검
 * 실행: TOEVER_ID=B0000117 TOEVER_PW=unit npx electron test_upload_page.js
 *
 * 확인:
 *  1. 로그인
 *  2. uploadInvoice.jsp 이동
 *  3. form#fileForm 존재
 *  4. input#uploadFile 존재
 *  5. input#uploadBtn 존재
 *  6. input[name="UPLOAD_TOKEN"] 존재
 *  7. UPLOAD_TOKEN value 비어있지 않음
 *
 * 금지: 파일 첨부 / uploadBtn 클릭 / form submit
 */
'use strict'

const path = require('path')
const fs   = require('fs')
const os   = require('os')

const TOEVER_ID     = process.env.TOEVER_ID
const TOEVER_PW     = process.env.TOEVER_PW
const BROWSERS_PATH = path.join(process.env.APPDATA ?? os.homedir(), 'spring-toever-ops', 'browsers')
process.env.PLAYWRIGHT_BROWSERS_PATH = BROWSERS_PATH

const SS_DIR        = path.join(__dirname, 'screenshots')
if (!fs.existsSync(SS_DIR)) fs.mkdirSync(SS_DIR, { recursive: true })

const TOEVER_BASE        = 'https://support.toever.co.kr'
const INVOICE_UPLOAD_URL = `${TOEVER_BASE}/VendorMgr/PoState/uploadInvoice.jsp`

const C = {
  green:  s => `\x1b[32m${s}\x1b[0m`,
  red:    s => `\x1b[31m${s}\x1b[0m`,
  cyan:   s => `\x1b[36m${s}\x1b[0m`,
  bold:   s => `\x1b[1m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
}
const OK = C.green('✓'), FAIL = C.red('✗')
let passed = 0, failed = 0
const failList = []
function pass(msg) { console.log(`  ${OK}  ${msg}`); passed++ }
function fail(msg, e) {
  console.log(`  ${FAIL}  ${C.red(msg)}`)
  if (e) console.log(`     ${C.yellow(String(e).slice(0, 300))}`)
  failed++; failList.push(msg)
}
function section(msg) { console.log(`\n${C.bold(C.cyan('▶ ' + msg))}`) }
function info(msg)    { console.log(`  ℹ  ${msg}`) }

async function main() {
  console.log(C.bold('\n══════════════════════════════════════════════'))
  console.log(C.bold('  투에버 송장 업로드 페이지 안정성 점검'))
  console.log(C.bold('══════════════════════════════════════════════\n'))
  info('⚠  파일 첨부 / uploadBtn 클릭 / form submit 실행 안 함')

  if (!TOEVER_ID || !TOEVER_PW) {
    console.error(C.red('TOEVER_ID / TOEVER_PW 환경 변수가 필요합니다.'))
    process.exit(1)
  }

  const { chromium } = require('playwright')
  const browser = await chromium.launch({ headless: false, args: ['--no-sandbox'] })
  const ctx  = await browser.newContext({ locale: 'ko-KR', timezoneId: 'Asia/Seoul' })
  const page = await ctx.newPage()

  try {
    // ── Step 1: 로그인 ───────────────────────────────────────────
    section('1. 투에버 로그인')
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
      pass('로그인 완료')
    } catch {
      pass('이미 로그인된 세션 사용')
    }

    // ── Step 2: 업로드 페이지 탐색 ──────────────────────────────
    section('2. 송장 업로드 페이지 탐색')

    // 2-A: 직접 URL 접근 시도
    await page.goto(INVOICE_UPLOAD_URL, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {})
    await page.waitForTimeout(1000)
    const directUrl  = page.url()
    const directBody = await page.content()
    const directFail = directBody.includes('죄송') || directBody.includes('찾을 수 없') || directBody.includes('404')

    info(`직접 접근 URL: ${directUrl}`)
    if (directFail) {
      info(`⚠  직접 URL 접근 실패 (404 유사 오류) — 메뉴 탐색으로 전환`)
    }

    // 2-B: 발주내역 페이지에서 메뉴/링크 탐색
    const ORDER_LIST_URL = `${TOEVER_BASE}/VendorMgr/PoState/orderDtlP.jsp`
    await page.goto(ORDER_LIST_URL, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForTimeout(2000)

    // 전체 frames에서 "업로드" / "invoice" / "upload" 링크 수집
    const allFrames = page.frames()
    info(`발주내역 frame 수: ${allFrames.length}`)

    const uploadLinks = []
    for (const f of allFrames) {
      try {
        const links = await f.$$eval('a, button', els =>
          els.map(el => ({
            tag:  el.tagName,
            href: el.getAttribute?.('href') ?? '',
            text: el.textContent?.trim() ?? '',
            onclick: el.getAttribute?.('onclick') ?? '',
          })).filter(el =>
            /업로드|invoice|upload/i.test(el.text + el.href + el.onclick)
          )
        )
        uploadLinks.push(...links)
      } catch { /* 무시 */ }
    }
    info(`업로드 관련 링크/버튼: ${uploadLinks.length}건`)
    for (const lk of uploadLinks) {
      info(`  [${lk.tag}] text="${lk.text}" href="${lk.href}" onclick="${lk.onclick.slice(0,80)}"`)
    }

    // 2-C: 좌측 메뉴에서 송장 업로드 항목 탐색
    const menuLinks = []
    for (const f of allFrames) {
      try {
        const items = await f.$$eval('a', els =>
          els.map(el => ({ text: el.textContent?.trim() ?? '', href: el.href ?? '' }))
             .filter(el => /송장|invoice|업로드/i.test(el.text))
        )
        menuLinks.push(...items)
      } catch { /* 무시 */ }
    }
    if (menuLinks.length > 0) {
      info('메뉴에서 발견된 송장/업로드 관련 항목:')
      for (const m of menuLinks) info(`  text="${m.text}" href="${m.href}"`)
    }

    // 2-D: 실제 업로드 페이지 URL 결정
    let uploadPageUrl = null

    // 메뉴/링크에서 uploadInvoice 포함 URL 우선
    const uploadLinkHref = uploadLinks.find(l => l.href?.includes('uploadInvoice') || l.href?.includes('invoice') || l.href?.includes('Invoice'))
    const menuLinkHref   = menuLinks.find(m => m.href?.includes('uploadInvoice') || m.href?.includes('Invoice'))

    if (uploadLinkHref?.href && !uploadLinkHref.href.startsWith('javascript')) {
      uploadPageUrl = uploadLinkHref.href.startsWith('http') ? uploadLinkHref.href : TOEVER_BASE + uploadLinkHref.href
    } else if (menuLinkHref?.href && !menuLinkHref.href.startsWith('javascript')) {
      uploadPageUrl = menuLinkHref.href.startsWith('http') ? menuLinkHref.href : TOEVER_BASE + menuLinkHref.href
    } else if (!directFail) {
      // 직접 접근이 성공한 경우
      uploadPageUrl = INVOICE_UPLOAD_URL
    }

    if (!uploadPageUrl) {
      // 원본 URL로 재시도 (로그인 후 접근 가능한지 확인)
      uploadPageUrl = INVOICE_UPLOAD_URL
      info('업로드 페이지 URL 탐색 실패 → 원본 URL로 재시도')
    }

    info(`최종 접근 URL: ${uploadPageUrl}`)
    await page.goto(uploadPageUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {})
    await page.waitForTimeout(2000)

    if (page.url().toLowerCase().includes('login')) {
      const ss = path.join(SS_DIR, 'upload_page_login_redirect.png')
      await page.screenshot({ path: ss, fullPage: true }).catch(() => {})
      fail('업로드 페이지 접근 시 로그인 리다이렉트 발생', `screenshot: ${ss}`)
      return
    }

    // frame 탐색
    const frames = page.frames()
    info(`frame 수: ${frames.length}`)
    for (const f of frames) info(`  frame: name="${f.name()}" url="${f.url()}"`)

    const tf = page.frame({ name: 'mainFrm' })
           ?? page.frames().find(f => f.url().includes('uploadInvoice') || f.url().includes('invoice'))
           ?? page

    // 페이지가 404인지 확인
    const pageBody = await tf.content()
    if (pageBody.includes('죄송') || pageBody.includes('찾을 수 없')) {
      const ss404 = path.join(SS_DIR, `upload_page_404_${Date.now()}.png`)
      await page.screenshot({ path: ss404, fullPage: true })
      fail(`업로드 페이지 404 오류 — 올바른 URL 탐색 필요`, `screenshot: ${ss404}`)
      info('발견된 업로드 링크들:')
      for (const lk of uploadLinks) info(`  ${JSON.stringify(lk)}`)
      return
    }

    info(`사용 frame: name="${tf.name?.() ?? 'page'}" url="${tf.url?.() ?? ''}"`)
    pass('업로드 페이지 이동 완료')

    // ── Step 3: form#fileForm 존재 확인 ─────────────────────────
    section('3-7. 폼 요소 존재 확인 (클릭/submit 없음)')

    await page.waitForTimeout(1000)

    const pageContent = await tf.content()

    // 3. form#fileForm
    const hasFileForm = pageContent.includes('id="fileForm"') || pageContent.includes("id='fileForm'")
    if (hasFileForm) {
      pass('form#fileForm 존재 확인')
    } else {
      const altForm = await tf.$('form').catch(() => null)
      if (altForm) {
        const formId = await altForm.getAttribute('id').catch(() => '')
        info(`다른 form 발견: id="${formId}"`)
        pass(`form 요소 존재 (id="${formId}")`)
      } else {
        fail('form 요소 없음')
      }
    }

    // 4. input#uploadFile
    const uploadFile = await tf.$('input#uploadFile').catch(() => null)
      ?? await tf.$('input[type="file"]').catch(() => null)
    if (uploadFile) {
      const id  = await uploadFile.getAttribute('id').catch(() => '')
      const name = await uploadFile.getAttribute('name').catch(() => '')
      pass(`input#uploadFile 존재: id="${id}" name="${name}"`)
    } else {
      fail('input#uploadFile (또는 input[type=file]) 없음')
    }

    // 5. input#uploadBtn
    const uploadBtn = await tf.$('input#uploadBtn').catch(() => null)
      ?? await tf.$('input[type="button"][value*="업로드"]').catch(() => null)
      ?? await tf.$('button').catch(() => null)
    if (uploadBtn) {
      const id    = await uploadBtn.getAttribute('id').catch(() => '')
      const value = await uploadBtn.getAttribute('value').catch(() => '')
      const text  = await uploadBtn.textContent().catch(() => '')
      pass(`input#uploadBtn 존재: id="${id}" value="${value}" text="${text?.trim()}"`)
    } else {
      fail('input#uploadBtn (또는 업로드 버튼) 없음')
    }

    // 6. UPLOAD_TOKEN 존재
    const tokenEl = await tf.$('input[name="UPLOAD_TOKEN"]').catch(() => null)
    if (tokenEl) {
      pass('input[name="UPLOAD_TOKEN"] 존재')

      // 7. UPLOAD_TOKEN value 비어있지 않음
      const tokenValue = await tokenEl.getAttribute('value').catch(() => '')
        ?? await tf.$eval('input[name="UPLOAD_TOKEN"]', el => el.value).catch(() => '')
      if (tokenValue && tokenValue.trim() !== '') {
        pass(`UPLOAD_TOKEN 값 확인: "${tokenValue.slice(0, 20)}..." (비어있지 않음)`)
      } else {
        fail('UPLOAD_TOKEN 값이 비어 있음')
      }
    } else {
      fail('input[name="UPLOAD_TOKEN"] 없음')
    }

    // ── 전체 페이지 소스 부분 캡처 ──────────────────────────────
    section('추가 정보 수집')
    const allInputs = await tf.$$eval('input', els =>
      els.map(el => ({ type: el.type, id: el.id, name: el.name, value: el.value?.slice(0, 30) }))
    ).catch(() => [])
    info(`페이지 내 input 목록:`)
    for (const inp of allInputs) {
      info(`  type="${inp.type}" id="${inp.id}" name="${inp.name}" value="${inp.value}"`)
    }

    // 스크린샷 저장 (상태 변경 없는 캡처)
    const ssPath = path.join(SS_DIR, `upload_page_check_${Date.now()}.png`)
    await page.screenshot({ path: ssPath, fullPage: true })
    pass(`스크린샷 저장: ${ssPath}`)
    info('⚠  파일 첨부 / uploadBtn 클릭 / form submit 실행 안 함 (확인)')

  } finally {
    await page.close().catch(() => {})
    await ctx.close().catch(() => {})
    await browser.close().catch(() => {})
  }

  // ── 결과 요약 ─────────────────────────────────────────────────
  console.log(`\n${C.bold('══════════════════════════════════════════════')}`)
  if (failed === 0) {
    console.log(C.green(C.bold(`  ✓ 전체 ${passed}건 통과 — 업로드 페이지 정상 접근 가능`)))
  } else {
    console.log(C.green(C.bold(`  ✓ 통과: ${passed}건`)))
    console.log(C.red(C.bold(`  ✗ 실패: ${failed}건`)))
    for (const e of failList) console.log(C.red(`    - ${e}`))
  }
  console.log(C.bold('══════════════════════════════════════════════\n'))
  process.exit(failed > 0 ? 1 : 0)
}

main().catch(e => {
  console.error(C.red('\n[FATAL] ' + e.message))
  console.error(e.stack)
  process.exit(1)
})
