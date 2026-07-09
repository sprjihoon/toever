/**
 * showReport_HTML 함수 소스 전체 추출 + window.open URL 가로채기
 * 실행: npx electron test_toever_explore2.js
 */
'use strict'

const path = require('path')
const fs   = require('fs')
const os   = require('os')

const DIST        = path.join(__dirname, 'dist-electron')
const STORAGE     = path.join(os.tmpdir(), 'toever_explore2_' + Date.now())
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
  yellow: s => `\x1b[33m${s}\x1b[0m`,
}
function section(msg) { console.log(`\n${C.bold(C.cyan('▶ ' + msg))}`) }
function info(msg)    { console.log(`  ℹ  ${msg}`) }
function found(msg)   { console.log(`  ${C.green('★')}  ${C.green(msg)}`) }
function warn(msg)    { console.log(`  ${C.red('!')}  ${C.red(msg)}`) }

async function main() {
  console.log(C.bold('\n══════════════════════════════════════════'))
  console.log(C.bold('  showReport_HTML 소스 전체 + URL 가로채기'))
  console.log(C.bold('══════════════════════════════════════════\n'))

  const storage = require(path.join(DIST, 'electron/services/storage.js'))
  storage.setBasePath(STORAGE)
  storage.ensureAllDirs()
  const { initDb } = require(path.join(DIST, 'electron/services/db/schema.js'))
  initDb(STORAGE)

  const { chromium } = require('playwright')
  let browser, ctx, page

  try {
    browser = await chromium.launch({ headless: false, args: ['--no-sandbox'] })
    ctx = await browser.newContext({ locale: 'ko-KR', timezoneId: 'Asia/Seoul' })
    page = await ctx.newPage()

    // ── 로그인 ─────────────────────────────────────────────────────
    section('1. 로그인 + 조회')
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
      info('로그인 완료')
    } catch { info('세션 재사용') }

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
    info('조회 완료')

    const af = page.frame({ name: 'mainFrm' }) ?? page.frame({ url: /orderDtlP/ }) ?? page

    // ── showReport_HTML 전체 소스 추출 ──────────────────────────────
    section('2. showReport_HTML 전체 소스')

    const fullSource = await af.evaluate(() => {
      // script 태그 전체 텍스트에서 showReport_HTML 함수 블록 추출
      const scripts = Array.from(document.querySelectorAll('script'))
      for (const s of scripts) {
        const content = s.textContent ?? ''
        if (!content.includes('showReport_HTML')) continue
        // 함수 정의 위치 찾기
        const idx = content.indexOf('function showReport_HTML')
        if (idx === -1) continue
        // 함수 끝 찾기 (중괄호 매칭)
        let depth = 0, start = idx, end = idx
        for (let i = idx; i < content.length; i++) {
          if (content[i] === '{') depth++
          else if (content[i] === '}') {
            depth--
            if (depth === 0) { end = i + 1; break }
          }
        }
        return content.slice(start, end)
      }
      // window 객체에서 직접
      if (typeof window['showReport_HTML'] === 'function') {
        return window['showReport_HTML'].toString()
      }
      return null
    })

    if (fullSource) {
      found('showReport_HTML 전체 소스:')
      console.log(C.dim('\n  ┌─────────────────────────────────────────────────────'))
      for (const line of fullSource.split('\n')) {
        console.log(C.dim('  │ ' + line))
      }
      console.log(C.dim('  └─────────────────────────────────────────────────────\n'))
    } else {
      warn('showReport_HTML 소스 추출 실패')
    }

    // ── openUrl 변수 값 직접 추출 ──────────────────────────────────
    section('3. openUrl 변수 값 직접 평가')

    const openUrlResult = await af.evaluate(() => {
      // showReport_HTML 함수 내에서 openUrl이 어떻게 만들어지는지 실행해서 가로채기
      // window.open을 덮어씌워 URL만 캡처
      let capturedUrl = null
      const origOpen = window.open
      window.open = (url, ...args) => {
        capturedUrl = url
        // 실제로는 창을 열지 않음
        return null
      }
      try {
        if (typeof window['showReport_HTML'] === 'function') {
          window['showReport_HTML']()
        }
      } catch (e) {
        // 무시
      }
      window.open = origOpen  // 복구
      return capturedUrl
    })

    if (openUrlResult) {
      found(`openUrl 캡처 성공!`)
      info(`URL: ${openUrlResult}`)

      // URL 파싱
      try {
        const urlObj = new URL(openUrlResult.startsWith('http')
          ? openUrlResult
          : TOEVER_BASE + (openUrlResult.startsWith('/') ? openUrlResult : '/' + openUrlResult)
        )
        console.log(`\n  ${C.bold('파싱된 URL:')}\n  ${C.cyan(urlObj.pathname)}`)
        console.log(`\n  ${C.bold('파라미터:')}`)
        for (const [k, v] of urlObj.searchParams.entries()) {
          info(`    ${k.padEnd(25)} = "${v}"`)
        }
      } catch { info(`(URL 파싱 불가, raw: ${openUrlResult})`) }
    } else {
      warn('openUrl 캡처 실패 - 함수가 실행되지 않았거나 동기가 아님')

      // 대안: 함수 소스에서 URL 패턴 추출
      if (fullSource) {
        section('3-1. 소스 정적 분석으로 URL 추출')
        const urlMatch = fullSource.match(/["']([^"']*rpt[^"']+\.jsp[^"']*)["']/gi) ?? []
        const varMatch = fullSource.match(/openUrl\s*=\s*[^;]+/g) ?? []
        const paramMatch = fullSource.match(/p_[a-z_]+/g) ?? []
        info(`rpt URL 패턴: ${urlMatch.join(' | ')}`)
        info(`openUrl 변수 할당: ${varMatch.join(' | ')}`)
        found(`파라미터 후보: ${[...new Set(paramMatch)].join(', ')}`)
      }
    }

    // ── 팝업 감지 테스트 (실제 실행은 팝업 캡처 후 즉시 닫기) ──────
    section('4. 실제 팝업 URL 감지 (열었다 즉시 닫기)')

    let popupUrl = null
    try {
      const popupPromise = ctx.waitForEvent('page', { timeout: 6000 })
      await af.evaluate(() => {
        if (typeof window['showReport_HTML'] === 'function') window['showReport_HTML']()
      })
      const popup = await popupPromise
      popupUrl = popup.url()
      found(`팝업 URL: ${popupUrl}`)
      await popup.close()  // 즉시 닫기
    } catch (e) {
      warn(`팝업 감지 실패: ${e.message?.slice(0, 80)}`)
    }

    // ── 최종 요약 ───────────────────────────────────────────────────
    section('최종 탐색 결과')
    const reportUrl = openUrlResult ?? popupUrl
    if (reportUrl) {
      found('출력 URL 확인 완료')
      info(`URL: ${reportUrl}`)
      info(`이 URL을 headless 브라우저에서 열어 page.pdf()로 저장하면 됩니다.`)
    } else if (fullSource) {
      warn('URL 자동 추출 실패 - 위 소스를 참고해 수동으로 확인 필요')
    }

    console.log(C.bold('\n  다음 단계: PDF 저장 구현 준비 완료\n'))

  } catch (e) {
    warn('예외: ' + e.message)
    console.error(e.stack)
  } finally {
    if (page)    await page.close().catch(() => {})
    if (ctx)     await ctx.close().catch(() => {})
    if (browser) await browser.close().catch(() => {})
    info('브라우저 종료')
  }
}

main().catch(e => { console.error('[FATAL]', e.message); process.exit(1) })
