/**
 * showReport_HTML() 실제 URL 인터셉트 탐색
 *
 * 실행: npx electron test_oz_params.js
 *
 * 목적: OZ Viewer에 넘겨지는 p_order_no / p_order_noTo 등
 *       실제 파라미터가 발주번호인지 주문번호인지 확인
 *
 * 절대 실행 금지:
 *   - 인쇄/저장 버튼 클릭 없음
 *   - form submit 없음
 *   - 상태 변경 없음
 */
'use strict'

const path = require('path')
const fs   = require('fs')
const os   = require('os')

const DIST      = path.join(__dirname, 'dist-electron')
const BASE_PATH = path.join(os.homedir(), 'toever-data')
const TEST_DATE = '2026-07-09'

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
const section = m => console.log(`\n${C.bold(C.cyan('▶ ' + m))}`)
const sep     = () => console.log(C.gray('  ─────────────────────────────────────────────────'))

const TOEVER_BASE    = 'https://support.toever.co.kr'
const ORDER_LIST_URL = `${TOEVER_BASE}/VendorMgr/PoState/orderDtlP.jsp`

async function main() {
  console.log(C.bold('\n══════════════════════════════════════════════'))
  console.log(C.bold('  showReport_HTML() 파라미터 인터셉트 탐색'))
  console.log(C.bold(`  날짜: ${TEST_DATE}`))
  console.log(C.bold('══════════════════════════════════════════════\n'))

  const storage = require(path.join(DIST, 'electron/services/storage.js'))
  storage.setBasePath(BASE_PATH)
  storage.ensureAllDirs()
  const { initDb } = require(path.join(DIST, 'electron/services/db/schema.js'))
  initDb(BASE_PATH)
  const browser = require(path.join(DIST, 'electron/services/toever/browser.js'))
  const ssDir   = storage.DIRS.logsScreenshots()

  let bSession = null

  try {
    // ── 1. 로그인 ─────────────────────────────────────────────────
    section('1. 투에버 로그인')
    bSession = await browser.launchBrowser(ssDir)
    const { page, context } = bSession
    const loginResult = await browser.loginToever(page, TOEVER_ID, TOEVER_PW)
    if (!loginResult.success) throw new Error(`로그인 실패: ${loginResult.error}`)
    info(`로그인 ${loginResult.sessionReused ? '(세션 재사용)' : '성공'}`)

    // ── 2. 발주내역 조회 ─────────────────────────────────────────
    section('2. 발주내역 조회 (2026-07-09)')
    await page.goto(ORDER_LIST_URL, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForTimeout(2000)

    const frame = page.frame({ name: 'mainFrm' }) ?? page
    await frame.waitForSelector('input[name="order_dt_from"]', { timeout: 15000 })

    const dateCompact = TEST_DATE.replace(/-/g, '')
    await frame.fill('input[name="order_dt_from"]', TEST_DATE)
    await frame.fill('input[name="order_dt_to"]',   TEST_DATE)
    await frame.evaluate(d => {
      const f = document.querySelector('input[name="p_order_dt_from"]')
      const t = document.querySelector('input[name="p_order_dt_to"]')
      if (f) f.value = d; if (t) t.value = d
    }, dateCompact)

    await Promise.all([
      frame.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {}),
      frame.click('input[type="image"][alt="조회"]'),
    ])
    await page.waitForTimeout(3000)

    await page.screenshot({ path: `${ssDir}/params_after_search.png`, fullPage: true })
    info('조회 완료')

    // ── 3. 결과 테이블에서 발주번호/주문번호 추출 ────────────────
    section('3. 조회 결과 테이블 컬럼 구조 파악')

    const tableInfo = await frame.evaluate(() => {
      // 테이블 헤더 추출
      const headers = Array.from(document.querySelectorAll('th, td.header, thead td'))
        .map(el => el.textContent?.trim()).filter(Boolean)

      // 첫 번째 데이터 테이블 행 추출
      const rows = Array.from(document.querySelectorAll('table tr')).slice(0, 5)
      const sampleRows = rows.map(tr =>
        Array.from(tr.querySelectorAll('td,th')).map(td => td.textContent?.trim().slice(0, 30))
      ).filter(r => r.some(c => c))

      // 발주번호 관련 input 탐색
      const poInputs = Array.from(document.querySelectorAll('input[name]')).map(el => ({
        name: el.name, value: el.value?.slice(0, 50), type: el.type,
      }))

      // 출력 링크 탐색
      const printLinks = Array.from(document.querySelectorAll('a, input[type=image], button'))
        .filter(el => {
          const s = (el.textContent + el.title + el.alt + (el.getAttribute('onclick') || '')).toLowerCase()
          return s.includes('출력') || s.includes('print') || s.includes('report')
        })
        .map(el => ({
          tag: el.tagName,
          text: el.textContent?.trim().slice(0, 50),
          href: el.href ?? '',
          onclick: el.getAttribute('onclick')?.slice(0, 150) ?? '',
          alt: el.alt ?? '',
          title: el.title ?? '',
        }))

      // 조회결과 전체 텍스트
      const bodySnippet = document.body?.innerText?.slice(0, 2000) ?? ''

      return { headers, sampleRows, poInputs, printLinks, bodySnippet }
    }).catch(e => ({ error: String(e) }))

    if (tableInfo.error) {
      warn(`테이블 탐색 오류: ${tableInfo.error}`)
    } else {
      info(`테이블 헤더: ${JSON.stringify(tableInfo.headers?.slice(0, 20))}`)
      info(`샘플 행 수: ${tableInfo.sampleRows?.length}`)
      tableInfo.sampleRows?.slice(0, 3).forEach((r, i) =>
        info(`  row[${i}]: ${JSON.stringify(r)}`)
      )

      sep()
      info('출력 관련 링크/버튼:')
      tableInfo.printLinks?.forEach((l, i) =>
        info(`  [${i}] <${l.tag}> text="${l.text}" alt="${l.alt}" onclick="${l.onclick}"`)
      )
    }

    // ── 4. getReportCommonParams() 직접 호출 ─────────────────────
    section('4. getReportCommonParams() 호출')
    const commonParams = await frame.evaluate(() => {
      if (typeof window.getReportCommonParams === 'function') {
        return window.getReportCommonParams()
      }
      return null
    }).catch(() => null)

    if (commonParams) {
      found('getReportCommonParams() 반환값:')
      Object.entries(commonParams).forEach(([k, v]) => info(`  ${k} = ${v}`))
    } else {
      warn('getReportCommonParams() 없음 또는 오류')
    }

    // ── 5. showReport_HTML() window.open 인터셉트 ───────────────
    section('5. showReport_HTML() window.open 인터셉트')

    // 새 페이지 이벤트를 먼저 등록 (popup)
    let capturedUrl = null

    // 방법 A: window.open 교체 후 showReport_HTML() 호출
    capturedUrl = await frame.evaluate(() => {
      return new Promise(resolve => {
        const orig = window.open
        let captured = null
        window.open = function(url, target, features) {
          captured = url
          window.open = orig  // 즉시 복원
          resolve(url)
          return null  // 실제 창 열지 않음
        }
        try {
          if (typeof window.showReport_HTML === 'function') {
            window.showReport_HTML()
          } else {
            resolve(null)
          }
        } catch (e) {
          resolve(null)
        }
        // 함수 실행 후 window.open이 호출 안 됐으면 1초 후 null
        setTimeout(() => { window.open = orig; resolve(null) }, 1500)
      })
    }).catch(() => null)

    if (capturedUrl) {
      found(`캡처된 URL: ${capturedUrl}`)
    } else {
      warn('방법 A 실패 — 방법 B 시도: 출력 링크 onclick 직접 파싱')

      // 방법 B: onclick 속성에서 URL 패턴 추출
      const onclickUrls = await frame.evaluate(() => {
        const all = Array.from(document.querySelectorAll('[onclick]'))
        return all
          .map(el => el.getAttribute('onclick'))
          .filter(s => s && s.includes('rptSale'))
          .map(s => s.slice(0, 300))
      }).catch(() => [])

      if (onclickUrls.length > 0) {
        found('onclick 내 URL 후보:')
        onclickUrls.forEach((u, i) => info(`  [${i}] ${u}`))
        capturedUrl = onclickUrls[0]
      } else {
        warn('방법 B도 실패')
      }
    }

    // ── 6. 팝업 이벤트로 URL 캡처 (방법 C) ──────────────────────
    if (!capturedUrl || !capturedUrl.includes('http')) {
      section('5-C. popup 이벤트로 URL 캡처')

      const popupPromise = context.waitForEvent('page', { timeout: 8000 }).catch(() => null)

      await frame.evaluate(() => {
        if (typeof window.showReport_HTML === 'function') window.showReport_HTML()
      }).catch(() => {})

      const popup = await popupPromise
      if (popup) {
        capturedUrl = popup.url()
        found(`팝업 URL 캡처: ${capturedUrl}`)
        await popup.close().catch(() => {})
      } else {
        warn('팝업도 감지되지 않음')
      }
    }

    // ── 7. URL 파라미터 파싱 및 보고 ────────────────────────────
    section('6. 캡처 URL 파라미터 분석')

    let parsedParams = {}
    if (capturedUrl && capturedUrl.includes('?')) {
      try {
        const url = new URL(capturedUrl.startsWith('http') ? capturedUrl : 'https://support.toever.co.kr' + capturedUrl)
        url.searchParams.forEach((v, k) => { parsedParams[k] = v })
      } catch (e) {
        // URL 파싱 실패 시 수동 파싱
        const qs = capturedUrl.split('?')[1] ?? ''
        for (const part of qs.split('&')) {
          const [k, v] = part.split('=')
          if (k) parsedParams[decodeURIComponent(k)] = decodeURIComponent(v ?? '')
        }
      }
    }

    // ── 8. 조회결과 화면에서 발주번호/주문번호 실제 값 추출 ─────
    section('7. 조회결과 테이블 발주번호 vs 주문번호 비교')

    const orderNums = await frame.evaluate(() => {
      // 테이블 행에서 번호처럼 보이는 셀 추출
      const allRows = Array.from(document.querySelectorAll('table tbody tr, table tr'))
      const result = []
      for (const tr of allRows.slice(0, 5)) {
        const cells = Array.from(tr.querySelectorAll('td')).map(td => td.textContent?.trim() ?? '')
        if (cells.length > 2) result.push(cells)
      }

      // 숫자 컬럼 중 긴 값(발주번호 후보) 추출
      const longNums = result.flatMap(row =>
        row.filter(c => /^\d{10,}$/.test(c))
      )

      return {
        sampleRows: result.slice(0, 5),
        longNums: [...new Set(longNums)].slice(0, 10),
        bodyText: document.body?.innerText?.slice(0, 3000) ?? '',
      }
    }).catch(() => ({ sampleRows: [], longNums: [], bodyText: '' }))

    info(`테이블 데이터 행 수: ${orderNums.sampleRows?.length}`)
    info(`10자 이상 숫자 후보 (발주/주문번호): ${JSON.stringify(orderNums.longNums)}`)
    sep()
    info('body text 앞 2000자:')
    console.log(C.gray((orderNums.bodyText ?? '').slice(0, 2000).split('\n').map(l => '    ' + l).join('\n')))

    // ── 9. 최종 보고 ────────────────────────────────────────────
    section('8. 최종 보고 17항목')
    console.log()

    const P = parsedParams
    const longNums = orderNums.longNums ?? []

    // p_order_no 발주번호 vs 주문번호 판단
    // 발주번호 형식: 010001YYYYMMDDXXXXX (19자, 010001로 시작)
    // 주문번호 형식: 다를 수 있음 — 실제 값을 보고 판단
    const isPoFormat  = v => v && /^0+\d{14,}$/.test(v)
    const pOrderNo    = P['p_order_no']    ?? ''
    const pOrderNoTo  = P['p_order_noTo']  ?? ''

    const row = (no, label, value) => {
      const v = value === undefined || value === '' ? C.gray('(없음)') : C.cyan(String(value))
      console.log(`  ${C.bold(String(no).padStart(2) + '.')} ${label.padEnd(40)} ${v}`)
    }

    row( 1, '캡처된 showReport_HTML URL', capturedUrl ?? '')
    row( 2, 'p_company_cd',               P['p_company_cd'])
    row( 3, 'p_merchant_cd',              P['p_merchant_cd'])
    row( 4, 'p_entr_no',                  P['p_entr_no'])
    row( 5, 'p_order_dt',                 P['p_order_dt'])
    row( 6, 'p_order_dtTo',              P['p_order_dtTo'])
    row( 7, 'p_storeout_sts',             P['p_storeout_sts'])
    row( 8, 'p_order_no',                 pOrderNo)
    row( 9, 'p_order_noTo',              pOrderNoTo)
    row(10, 'p_order_no 타입 판단',       pOrderNo ? (isPoFormat(pOrderNo) ? '발주번호(앞자리0 패턴)' : '주문번호 또는 불명') : '')
    row(11, 'p_order_noTo 타입 판단',    pOrderNoTo ? (isPoFormat(pOrderNoTo) ? '발주번호(앞자리0 패턴)' : '주문번호 또는 불명') : '')
    row(12, '결과 첫 번째 긴 숫자',      longNums[0])
    row(13, '결과 마지막 긴 숫자',       longNums[longNums.length - 1])
    row(14, '결과 추가 번호들',          longNums.slice(0, 6).join(', '))

    sep()
    console.log()

    // 원인 추정
    const cause = []
    if (!capturedUrl) cause.push('"조회된 데이터가 없습니다" — showReport_HTML URL 미캡처, 파라미터 확인 불가')
    if (P['p_storeout_sts'] === '01') cause.push('p_storeout_sts=01은 "출고완료" 상태 필터 — 신규 주문은 해당 없을 수 있음')
    if (P['p_storeout_sts'] === '' || !P['p_storeout_sts']) cause.push('p_storeout_sts 값이 비어있거나 미확인')
    if (pOrderNo && !isPoFormat(pOrderNo)) cause.push(`p_order_no="${pOrderNo}" — 발주번호 형식이 아닐 수 있음`)
    if (commonParams && !pOrderNo) cause.push('getReportCommonParams()의 p_order_no와 showReport_HTML URL 불일치 가능')

    row(15, '"조회된 데이터 없음" 원인 추정', cause.join(' | ') || '(URL 확인 필요)')

    // 다음 구현 방향
    const nextSteps = []
    if (capturedUrl && P['p_storeout_sts']) {
      nextSteps.push(`p_storeout_sts 값 "${P['p_storeout_sts']}" 사용, 같은 값으로 OZ Viewer 재접근`)
    }
    if (!capturedUrl) {
      nextSteps.push('showReport_HTML onclick 직접 추출 또는 발주내역 페이지 재탐색 필요')
    }
    if (capturedUrl && isPoFormat(pOrderNo)) {
      nextSteps.push('p_order_no가 발주번호 형식 — 현재 파라미터 유지, 로딩 완료 조건만 수정')
    }
    if (capturedUrl && !isPoFormat(pOrderNo)) {
      nextSteps.push('p_order_no 값 재검토 — 발주번호와 주문번호 컬럼 구분 필요')
    }
    nextSteps.push('로딩 완료 조건: body 길이 조건 제거, 로딩 문구 사라짐 + networkidle 복합 사용')
    nextSteps.push('OZ Viewer 로딩 완료 후 인쇄 버튼 클릭 + CDP printToPDF 방식 구현')

    row(16, '다음 구현 방향', nextSteps.join('\n' + ' '.repeat(46)))

    console.log()
    const ssFinal = `${ssDir}/params_final.png`
    await page.screenshot({ path: ssFinal, fullPage: true })
    info(`최종 스크린샷: ${ssFinal}`)

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
    console.error(err.stack)
    process.exit(1)
  })
