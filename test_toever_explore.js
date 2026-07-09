/**
 * 투에버 발주내역 출력 구조 탐색 (PDF 구현 전 사전 조사)
 * 실행: npx electron test_toever_explore.js
 * - PDF 저장 실행 안 함
 * - 송장업로드/출고작업지시 실행 안 함
 */
'use strict'

const path = require('path')
const fs   = require('fs')
const os   = require('os')

const DIST        = path.join(__dirname, 'dist-electron')
const STORAGE     = path.join(os.tmpdir(), 'toever_explore_' + Date.now())
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
  dim:   s => `\x1b[2m${s}\x1b[0m`,
}
function section(msg) { console.log(`\n${C.bold(C.cyan('▶ ' + msg))}`) }
function info(msg)    { console.log(`  ℹ  ${msg}`) }
function found(msg)   { console.log(`  ${C.green('★')}  ${C.green(msg)}`) }
function warn(msg)    { console.log(`  ${C.red('!')}  ${C.red(msg)}`) }

async function main() {
  console.log(C.bold('\n══════════════════════════════════════════'))
  console.log(C.bold('  투에버 출력 구조 탐색 (사전 조사)'))
  console.log(C.bold('══════════════════════════════════════════\n'))
  info(`날짜: ${TEST_DATE}`)

  if (!TOEVER_ID || !TOEVER_PW) { console.error('TOEVER_ID/PW 필요'); process.exit(1) }

  // 스토리지/DB 초기화
  const storage = require(path.join(DIST, 'electron/services/storage.js'))
  storage.setBasePath(STORAGE)
  storage.ensureAllDirs()
  const { initDb } = require(path.join(DIST, 'electron/services/db/schema.js'))
  initDb(STORAGE)
  const ssDir = storage.DIRS.logsScreenshots()

  const { chromium } = require('playwright')
  let browser, ctx, page

  try {
    browser = await chromium.launch({ headless: false, args: ['--no-sandbox'] })
    ctx = await browser.newContext({ locale: 'ko-KR', timezoneId: 'Asia/Seoul' })
    page = await ctx.newPage()

    // ── 로그인 ─────────────────────────────────────────────────────
    section('1. 로그인')
    await page.goto(TOEVER_BASE, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForTimeout(2000)

    const mainFrame = page.frame({ name: 'mainFrm' }) ?? page
    try {
      await mainFrame.waitForSelector('input[name="p_login_id"]', { timeout: 8000 })
      await mainFrame.fill('input[name="p_login_id"]', TOEVER_ID)
      await mainFrame.fill('input[name="p_password"]',  TOEVER_PW)
      await Promise.all([
        mainFrame.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {}),
        mainFrame.click('input[type="image"][alt="로그인"]'),
      ])
      await page.waitForTimeout(2000)
      info('로그인 완료')
    } catch { info('세션 유효 (로그인 생략)') }

    // ── 발주내역 조회 ───────────────────────────────────────────────
    section('2. 발주내역 조회')
    await page.goto(ORDER_LIST_URL, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForTimeout(2000)

    const tf = page.frame({ name: 'mainFrm' }) ?? page.frame({ url: /orderDtlP/ }) ?? page
    await tf.waitForSelector('input[name="order_dt_from"]', { timeout: 15000 })

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
      tf.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {}),
      tf.click('input[type="image"][alt="조회"]'),
    ])
    await page.waitForTimeout(3000)
    info('조회 완료')

    // 조회 후 frame 재취득
    const af = page.frame({ name: 'mainFrm' }) ?? page.frame({ url: /orderDtlP/ }) ?? page

    // ── 프레임 구조 탐색 ────────────────────────────────────────────
    section('3. 프레임 구조')
    const allFrames = page.frames()
    info(`총 프레임 수: ${allFrames.length}`)
    for (const fr of allFrames) {
      info(`  [frame] name="${fr.name()}" url="${fr.url()}"`)
    }

    // ── 출력 관련 버튼/링크 탐색 ────────────────────────────────────
    section('4. 출력 관련 버튼·링크 탐색')

    const printEls = await af.$$eval(
      'a, input[type="button"], input[type="image"], button',
      els => els.map(el => ({
        tag:     el.tagName,
        type:    el.getAttribute('type') ?? '',
        alt:     el.getAttribute('alt') ?? '',
        value:   el.getAttribute('value') ?? '',
        href:    el.getAttribute('href') ?? '',
        onclick: el.getAttribute('onclick') ?? '',
        text:    el.textContent?.trim().slice(0, 60) ?? '',
        src:     el.getAttribute('src') ?? '',
        name:    el.getAttribute('name') ?? '',
      })).filter(el =>
        el.alt.includes('출력') || el.alt.includes('인쇄') || el.alt.includes('PDF') ||
        el.value.includes('출력') || el.value.includes('인쇄') || el.value.includes('PDF') ||
        el.text.includes('출력') || el.text.includes('인쇄') || el.text.includes('PDF') ||
        el.onclick.toLowerCase().includes('print') ||
        el.onclick.toLowerCase().includes('report') ||
        el.onclick.toLowerCase().includes('showreport') ||
        el.href.toLowerCase().includes('print') ||
        el.href.toLowerCase().includes('report')
      )
    )

    if (printEls.length === 0) {
      warn('출력 관련 버튼/링크 없음')
    } else {
      found(`출력 관련 요소 ${printEls.length}개 발견`)
      for (const el of printEls) {
        console.log(`\n  ${C.bold('[' + el.tag + ']')}`)
        if (el.alt)     info(`    alt:     "${el.alt}"`)
        if (el.value)   info(`    value:   "${el.value}"`)
        if (el.text)    info(`    text:    "${el.text}"`)
        if (el.href)    info(`    href:    "${el.href}"`)
        if (el.onclick) info(`    onclick: "${el.onclick}"`)
        if (el.src)     info(`    src:     "${el.src}"`)
        if (el.name)    info(`    name:    "${el.name}"`)
      }
    }

    // ── showReport_HTML 함수 탐색 ───────────────────────────────────
    section('5. showReport_HTML 함수 탐색')

    const fnInfo = await af.evaluate(() => {
      const result = {
        exists: false,
        source: '',
        windowOpenUrl: '',
        allArgs: [],
      }
      if (typeof window['showReport_HTML'] === 'function') {
        result.exists = true
        result.source = window['showReport_HTML'].toString().slice(0, 2000)
      }
      // 모든 script 태그에서 showReport_HTML 정의 찾기
      const scripts = Array.from(document.querySelectorAll('script'))
      for (const s of scripts) {
        if (s.textContent && s.textContent.includes('showReport_HTML')) {
          result.source = s.textContent
            .split('\n')
            .filter(line => line.includes('showReport_HTML') || line.includes('window.open'))
            .join('\n')
            .slice(0, 3000)
          break
        }
      }
      return result
    })

    if (fnInfo.exists) {
      found('showReport_HTML 함수 존재 (window 전역)')
    } else if (fnInfo.source) {
      found('showReport_HTML 코드를 script 태그에서 발견')
    } else {
      warn('showReport_HTML 함수 없음')
    }
    if (fnInfo.source) {
      console.log(C.dim('\n  --- showReport_HTML 소스 ---'))
      for (const line of fnInfo.source.split('\n').slice(0, 40)) {
        console.log(C.dim('  ' + line))
      }
      console.log(C.dim('  ---'))
    }

    // ── 실제 호출 파라미터 추출 ─────────────────────────────────────
    section('6. showReport_HTML 호출 파라미터 추출')

    const callParams = await af.evaluate(() => {
      // 페이지의 모든 onclick 속성에서 showReport_HTML 호출 추출
      const calls = []
      const allEls = document.querySelectorAll('[onclick]')
      for (const el of allEls) {
        const oc = el.getAttribute('onclick') ?? ''
        if (oc.includes('showReport_HTML')) {
          calls.push({
            tag: el.tagName,
            text: el.textContent?.trim().slice(0, 40) ?? '',
            onclick: oc,
          })
        }
      }
      // href에서도 확인
      const allLinks = document.querySelectorAll('a[href]')
      for (const a of allLinks) {
        const h = a.getAttribute('href') ?? ''
        if (h.includes('showReport_HTML') || h.includes('Report')) {
          calls.push({
            tag: 'A(href)',
            text: a.textContent?.trim().slice(0, 40) ?? '',
            onclick: h,
          })
        }
      }
      // script 태그에서 호출 패턴 추출
      const scripts = document.querySelectorAll('script')
      for (const s of scripts) {
        const content = s.textContent ?? ''
        const lines = content.split('\n')
        for (const line of lines) {
          if (line.includes('showReport_HTML') && line.trim().length < 500) {
            calls.push({ tag: 'SCRIPT', text: '', onclick: line.trim() })
          }
        }
      }
      return calls.slice(0, 20) // 최대 20개
    })

    if (callParams.length === 0) {
      warn('showReport_HTML 호출 패턴 없음')
    } else {
      found(`showReport_HTML 호출 패턴 ${callParams.length}개 발견`)
      for (const c of callParams) {
        console.log(`\n  ${C.bold('[' + c.tag + ']')} ${c.text}`)
        info(`    ${c.onclick}`)
      }
    }

    // ── window.open 호출 URL 탐색 ───────────────────────────────────
    section('7. window.open URL 탐색')

    const windowOpenUrls = await af.evaluate(() => {
      const urls = []
      const scripts = document.querySelectorAll('script')
      for (const s of scripts) {
        const content = s.textContent ?? ''
        const lines = content.split('\n')
        for (const line of lines) {
          if (line.includes('window.open') && line.includes('rpt')) {
            urls.push(line.trim().slice(0, 300))
          }
        }
      }
      // 폼 action 확인
      const forms = document.querySelectorAll('form')
      for (const f of forms) {
        const action = f.getAttribute('action') ?? ''
        if (action.includes('rpt') || action.includes('print') || action.includes('Report')) {
          urls.push(`FORM action="${action}"`)
        }
      }
      return [...new Set(urls)].slice(0, 15)
    })

    if (windowOpenUrls.length === 0) {
      warn('window.open rpt URL 없음')
    } else {
      found(`window.open 관련 코드 ${windowOpenUrls.length}개`)
      for (const u of windowOpenUrls) {
        info(`  ${u}`)
      }
    }

    // ── form 목록 탐색 ──────────────────────────────────────────────
    section('8. 폼 목록 탐색')

    const forms = await af.$$eval('form', els => els.map(f => ({
      name:   f.getAttribute('name') ?? '',
      id:     f.getAttribute('id') ?? '',
      action: f.getAttribute('action') ?? '',
      method: f.getAttribute('method') ?? '',
      inputs: Array.from(f.querySelectorAll('input[type="hidden"]'))
        .map(i => ({ name: i.getAttribute('name'), value: i.getAttribute('value') }))
        .slice(0, 15),
    })))

    info(`총 폼 수: ${forms.length}`)
    for (const f of forms) {
      console.log(`\n  ${C.bold('[FORM]')} name="${f.name}" action="${f.action}"`)
      for (const inp of f.inputs) {
        info(`    hidden: name="${inp.name}" value="${(inp.value ?? '').slice(0, 60)}"`)
      }
    }

    // ── 스크린샷 저장 ───────────────────────────────────────────────
    section('9. 스크린샷 저장')
    const ssPath = path.join(ssDir, `${Date.now()}_explore_order_list.png`)
    await page.screenshot({ path: ssPath, fullPage: false })
    info(`스크린샷: ${ssPath}`)

    // ── 탐색 결과 요약 ──────────────────────────────────────────────
    section('탐색 결과 요약')
    console.log(C.bold('\n  ┌─ 발견 항목 ─────────────────────────────────────┐'))
    console.log(`  │  출력 버튼/링크:          ${printEls.length}개`)
    console.log(`  │  showReport_HTML 함수:   ${fnInfo.exists ? '존재' : fnInfo.source ? '스크립트에 있음' : '없음'}`)
    console.log(`  │  showReport_HTML 호출:   ${callParams.length}개`)
    console.log(`  │  window.open rpt:        ${windowOpenUrls.length}개`)
    console.log(`  │  폼 수:                  ${forms.length}개`)
    console.log(C.bold('  └──────────────────────────────────────────────────┘'))

    info('--- PDF 저장은 위 탐색 결과 확인 후 다음 단계에서 구현 ---')

  } catch (e) {
    warn('예외 발생: ' + e.message)
    console.error(e.stack)
  } finally {
    if (page)    await page.close().catch(() => {})
    if (ctx)     await ctx.close().catch(() => {})
    if (browser) await browser.close().catch(() => {})
    info('브라우저 종료')
  }
}

main().catch(e => {
  console.error('\n[FATAL]', e.message)
  process.exit(1)
})
