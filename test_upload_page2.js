/**
 * 실제 송장 업로드 페이지 구조 확인
 * URL: /deliveryupload/deliveryListP.jsp
 * 실행: TOEVER_ID=B0000117 TOEVER_PW=unit npx electron test_upload_page2.js
 *
 * - 실제 업로드 실행 없음 / 클릭 없음 / submit 없음
 */
'use strict'

const path = require('path')
const fs   = require('fs')
const os   = require('os')

const TOEVER_ID     = process.env.TOEVER_ID
const TOEVER_PW     = process.env.TOEVER_PW
const BROWSERS_PATH = path.join(process.env.APPDATA ?? os.homedir(), 'spring-toever-ops', 'browsers')
process.env.PLAYWRIGHT_BROWSERS_PATH = BROWSERS_PATH

const SS_DIR = path.join(__dirname, 'screenshots')
if (!fs.existsSync(SS_DIR)) fs.mkdirSync(SS_DIR, { recursive: true })

const TOEVER_BASE    = 'https://support.toever.co.kr'
const UPLOAD_URL     = `${TOEVER_BASE}/deliveryupload/deliveryListP.jsp`

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
  if (e) console.log(`     ${C.yellow(String(e).slice(0, 300))}`)
  failed++; failList.push(msg)
}
function section(msg) { console.log(`\n${C.bold(C.cyan('▶ ' + msg))}`) }
function info(msg)    { console.log(`  ℹ  ${msg}`) }

async function main() {
  console.log(C.bold('\n══════════════════════════════════════════════'))
  console.log(C.bold('  투에버 송장 업로드 페이지 구조 확인'))
  console.log(C.bold('══════════════════════════════════════════════\n'))
  info('⚠  파일 첨부 / 버튼 클릭 / form submit 실행 안 함')
  info(`대상 URL: ${UPLOAD_URL}`)

  if (!TOEVER_ID || !TOEVER_PW) { console.error('TOEVER_ID/PW 필요'); process.exit(1) }

  const { chromium } = require('playwright')
  const browser = await chromium.launch({ headless: false, args: ['--no-sandbox'] })
  const ctx  = await browser.newContext({ locale: 'ko-KR', timezoneId: 'Asia/Seoul' })
  const page = await ctx.newPage()

  try {
    // ── 로그인 ───────────────────────────────────────────────────
    section('1. 로그인')
    await page.goto(TOEVER_BASE, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForTimeout(1500)
    const mf = page.frame({ name: 'mainFrm' }) ?? page
    try {
      await mf.waitForSelector('input[name="p_login_id"]', { timeout: 5000 })
      await mf.fill('input[name="p_login_id"]', TOEVER_ID)
      await mf.fill('input[name="p_password"]',  TOEVER_PW)
      await Promise.all([
        mf.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {}),
        mf.click('input[type="image"][alt="로그인"]'),
      ])
      await page.waitForTimeout(1500)
      pass('로그인 완료')
    } catch { pass('세션 재사용') }

    // ── 업로드 페이지 이동 ───────────────────────────────────────
    section('2. 송장 업로드 페이지 이동')
    await page.goto(UPLOAD_URL, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {})
    await page.waitForTimeout(2000)

    const finalUrl = page.url()
    info(`최종 URL: ${finalUrl}`)

    if (finalUrl.toLowerCase().includes('login')) {
      fail('로그인 리다이렉트 발생')
      return
    }

    // frame 구조 탐색
    const frames = page.frames()
    info(`frame 수: ${frames.length}`)
    for (const f of frames) info(`  frame: name="${f.name()}" url="${f.url()}"`)

    // 작업 대상 frame 결정
    const tf = page.frame({ name: 'mainFrm' })
           ?? page.frames().find(f => f.url().includes('deliveryListP') || f.url().includes('deliveryupload'))
           ?? page

    info(`작업 frame: name="${tf.name?.() ?? 'page'}" url="${tf.url?.() ?? ''}"`)

    // 404 판별: 투에버 공통 에러 페이지 특징적 문구만 체크
    const pageContent = await tf.content()
    const is404 = pageContent.includes('이용에 불편을 드려') || pageContent.includes('페이지를 찾을 수 없습니다')
    if (is404) {
      const ss = path.join(SS_DIR, 'delivery_page_404.png')
      await page.screenshot({ path: ss, fullPage: true })
      fail(`deliveryListP.jsp 접근 실패 (404)`, ss)
      return
    }

    pass('페이지 접근 성공 (404 아님)')

    // 스크린샷 저장 (상태 변경 없는 캡처)
    const ss = path.join(SS_DIR, `delivery_upload_page_${Date.now()}.png`)
    await page.screenshot({ path: ss, fullPage: true })
    pass(`스크린샷 저장: ${path.basename(ss)}`)

    // ── 폼 요소 탐색 ─────────────────────────────────────────────
    section('3. 폼 요소 확인')

    // 모든 input 수집
    const inputs = await tf.$$eval('input', els => els.map(el => ({
      type: el.type, id: el.id, name: el.name,
      value: el.value?.slice(0, 30),
      accept: el.getAttribute('accept') ?? '',
    }))).catch(() => [])

    info(`input 목록 (${inputs.length}건):`)
    for (const inp of inputs) {
      info(`  type="${inp.type}" id="${inp.id}" name="${inp.name}" value="${inp.value}" accept="${inp.accept}"`)
    }

    // 모든 form 수집
    const forms = await tf.$$eval('form', fls => fls.map(fm => ({
      id: fm.id, action: fm.action, method: fm.method,
      enctype: fm.enctype,
    }))).catch(() => [])

    info(`form 목록 (${forms.length}건):`)
    for (const fm of forms) {
      info(`  id="${fm.id}" action="${fm.action}" method="${fm.method}" enctype="${fm.enctype}"`)
    }

    // 모든 button/a 수집
    const btns = await tf.$$eval('input[type="button"],input[type="submit"],button,a', els =>
      els.map(el => ({
        tag: el.tagName, type: el.getAttribute('type') ?? '',
        id: el.id, text: el.textContent?.trim().slice(0, 30),
        value: el.getAttribute('value') ?? '',
        href: el.getAttribute('href') ?? '',
        onclick: el.getAttribute('onclick')?.slice(0, 80) ?? '',
      }))
    ).catch(() => [])

    info(`버튼/링크 목록 (${btns.length}건):`)
    for (const b of btns) {
      info(`  [${b.tag}] type="${b.type}" id="${b.id}" text="${b.text}" value="${b.value}" onclick="${b.onclick}"`)
    }

    // ── 핵심 요소 확인 ────────────────────────────────────────────
    section('4. 핵심 요소 존재 여부')

    // file input
    const fileInput = inputs.find(i => i.type === 'file' || i.name?.toLowerCase().includes('file'))
    if (fileInput) {
      pass(`파일 input: type="${fileInput.type}" id="${fileInput.id}" name="${fileInput.name}"`)
    } else {
      fail('파일 input 없음 (type=file)')
    }

    // 업로드 버튼
    const uploadBtn = btns.find(b =>
      /업로드|upload|Upload|등록|submit/i.test(b.text + b.value + b.onclick)
    )
    if (uploadBtn) {
      pass(`업로드 버튼: [${uploadBtn.tag}] id="${uploadBtn.id}" text="${uploadBtn.text}" value="${uploadBtn.value}"`)
    } else {
      fail('업로드 버튼 없음')
    }

    // 토큰 또는 hidden input
    const hiddenInputs = inputs.filter(i => i.type === 'hidden')
    info(`hidden input 수: ${hiddenInputs.length}건`)
    for (const h of hiddenInputs) info(`  name="${h.name}" value="${h.value}"`)

    const tokenInput = inputs.find(i => i.name?.toLowerCase().includes('token') || i.name?.toLowerCase().includes('csrf'))
    if (tokenInput) {
      pass(`토큰 input: name="${tokenInput.name}" value="${tokenInput.value?.slice(0, 20) || '(비어있음)'}"`)
    } else {
      info('UPLOAD_TOKEN / csrf token 없음 (없어도 정상일 수 있음)')
    }

    // form enctype (multipart 여부)
    const multipartForm = forms.find(fm => fm.enctype?.includes('multipart') || fm.method?.toLowerCase() === 'post')
    if (multipartForm) {
      pass(`multipart form: id="${multipartForm.id}" action="${multipartForm.action}"`)
    } else if (forms.length > 0) {
      info(`form 있으나 multipart 아님: ${JSON.stringify(forms[0])}`)
    }

    // ── 최종 URL + selector 정보 보고 ────────────────────────────
    section('5. 업로드 자동화 구현을 위한 정보 수집')

    // 실제 사용할 selector들
    const fileInputSelector = fileInput
      ? (fileInput.id ? `input#${fileInput.id}` : `input[name="${fileInput.name}"]`)
      : 'input[type="file"]'

    const uploadBtnSelector = uploadBtn
      ? (uploadBtn.id ? `${uploadBtn.tag.toLowerCase()}#${uploadBtn.id}` : `${uploadBtn.tag.toLowerCase()}[value="${uploadBtn.value}"]`)
      : 'input[type="submit"]'

    info(`파일 input selector:  ${fileInputSelector}`)
    info(`업로드 버튼 selector: ${uploadBtnSelector}`)
    info(`업로드 페이지 URL:    ${UPLOAD_URL}`)
    info('⚠  파일 첨부 / 버튼 클릭 / form submit 실행 안 함 (확인)')

  } finally {
    await page.close().catch(() => {})
    await ctx.close().catch(() => {})
    await browser.close().catch(() => {})
  }

  console.log(`\n${C.bold('══════════════════════════════════════════════')}`)
  if (failed === 0) {
    console.log(C.green(C.bold(`  ✓ 전체 ${passed}건 통과`)))
  } else {
    console.log(C.green(C.bold(`  ✓ 통과: ${passed}건`)))
    console.log(C.red(C.bold(`  ✗ 실패: ${failed}건`)))
    for (const e of failList) console.log(C.red(`    - ${e}`))
  }
  console.log(C.bold('══════════════════════════════════════════════\n'))
  process.exit(failed > 0 ? 1 : 0)
}

main().catch(e => { console.error('[FATAL]', e.message, e.stack); process.exit(1) })
