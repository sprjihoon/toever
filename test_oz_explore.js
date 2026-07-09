/**
 * OZ Report Viewer 구조 탐색 스크립트
 *
 * 실행: npx electron test_oz_explore.js
 *
 * 목적: page.pdf()가 로딩 화면만 저장하는 문제를 해결하기 위해
 *       OZ Viewer 로딩 완료 후 DOM 구조 / 버튼 후보를 탐색한다.
 *
 * 절대 실행 금지:
 *   - 버튼 클릭 없음
 *   - form submit 없음
 *   - 상태 변경 없음
 *   - 송장 업로드 없음
 *   - 출고작업지시 없음
 */
'use strict'

const path  = require('path')
const fs    = require('fs')
const os    = require('os')

const DIST      = path.join(__dirname, 'dist-electron')
const BASE_PATH = path.join(os.homedir(), 'toever-data')
const TEST_DATE = '2026-07-09'

// 오늘 테스트에서 확인된 발주번호 범위
const P_ORDER_NO    = '0100012026070900087'
const P_ORDER_NO_TO = '0100012026070900115'

const TOEVER_BASE = 'https://support.toever.co.kr'
const LOGIN_URL   = `${TOEVER_BASE}/Login/login.jsp`
const OZ_URL_BASE = `${TOEVER_BASE}/VendorMgr/PoState/rptSalePaperPrintP_HTML.jsp`

const TOEVER_ID = process.env.TOEVER_ID ?? 'B0000117'
const TOEVER_PW = process.env.TOEVER_PW ?? 'unit'

process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(
  process.env.APPDATA ?? os.homedir(),
  'spring-toever-ops', 'browsers'
)

// ── 출력 유틸 ──────────────────────────────────────────────────────
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

// ── OZ Viewer URL 구성 ─────────────────────────────────────────────
const dateCompact = TEST_DATE.replace(/-/g, '')
const ozParams = new URLSearchParams({
  p_xml_file:     '/SALE/vendor_sale_paper_new.ozr',
  p_company_cd:   '01',
  p_merchant_cd:  '0001',
  p_entr_no:      '00117',
  p_order_dt:     dateCompact,
  p_order_dtTo:   dateCompact,
  p_storeout_sts: '01',
  p_order_no:     P_ORDER_NO,
  p_order_noTo:   P_ORDER_NO_TO,
})
const OZ_URL = `${OZ_URL_BASE}?${ozParams.toString()}`

// ── 메인 ────────────────────────────────────────────────────────────
async function main() {
  console.log(C.bold('\n══════════════════════════════════════════════'))
  console.log(C.bold('  OZ Report Viewer 구조 탐색'))
  console.log(C.bold(`  날짜: ${TEST_DATE}`))
  console.log(C.bold('══════════════════════════════════════════════'))
  info(`OZ URL: ${OZ_URL}\n`)

  // ── 환경 초기화 ────────────────────────────────────────────────
  const storage = require(path.join(DIST, 'electron/services/storage.js'))
  storage.setBasePath(BASE_PATH)
  storage.ensureAllDirs()

  const { initDb } = require(path.join(DIST, 'electron/services/db/schema.js'))
  initDb(BASE_PATH)

  const browser  = require(path.join(DIST, 'electron/services/toever/browser.js'))
  const { chromium } = require('playwright')

  let bSession = null

  try {
    // ── 1. 로그인 ──────────────────────────────────────────────────
    section('1. 투에버 로그인')
    const ssDir = storage.DIRS.logsScreenshots()
    if (!fs.existsSync(ssDir)) fs.mkdirSync(ssDir, { recursive: true })

    bSession = await browser.launchBrowser(ssDir)
    const { page: mainPage, context } = bSession

    const loginResult = await browser.loginToever(mainPage, TOEVER_ID, TOEVER_PW)
    if (!loginResult.success) throw new Error(`로그인 실패: ${loginResult.error}`)
    info(`로그인 ${loginResult.sessionReused ? '(세션 재사용)' : '성공'}`)

    // ── 2. OZ Viewer 페이지 열기 ───────────────────────────────────
    section('2. OZ Report Viewer 페이지 열기')
    info(`URL: ${OZ_URL}`)

    // 동일 context의 새 탭에서 열기 (로그인 쿠키 공유)
    const ozPage = await context.newPage()
    await ozPage.goto(OZ_URL, { waitUntil: 'domcontentloaded', timeout: 30000 })

    // 초기 스크린샷
    const ss1Path = path.join(ssDir, 'oz_after_open.png')
    await ozPage.screenshot({ path: ss1Path, fullPage: true })
    info(`초기 스크린샷: ${ss1Path}`)

    // ── 3. 로딩 완료 대기 ─────────────────────────────────────────
    section('3. OZ Viewer 로딩 완료 대기')

    const LOADING_TEXTS = [
      '오즈 리포트 뷰어를 실행하고 있습니다',
      '데이터 모듈을 받기 시작합니다',
      '데이터 모듈을 받고 있습니다',
    ]

    let loadingGone = false
    const MAX_WAIT_MS = 45000
    const POLL_MS    = 2000
    let elapsed = 0

    while (elapsed < MAX_WAIT_MS) {
      await ozPage.waitForTimeout(POLL_MS)
      elapsed += POLL_MS

      const bodyText = await ozPage.evaluate(() =>
        document.body?.innerText ?? ''
      ).catch(() => '')

      const stillLoading = LOADING_TEXTS.some(t => bodyText.includes(t))
      info(`[${elapsed / 1000}s] 로딩 문구 존재: ${stillLoading ? '예' : '아니오'}  (body 길이: ${bodyText.length}자)`)

      if (!stillLoading && bodyText.length > 100) {
        loadingGone = true
        info('로딩 문구 사라짐 → 5초 추가 대기')
        await ozPage.waitForTimeout(5000)
        break
      }
    }

    // 로딩 완료 후 스크린샷
    const ss2Path = path.join(ssDir, 'oz_after_load.png')
    await ozPage.screenshot({ path: ss2Path, fullPage: true })
    info(`로딩 후 스크린샷: ${ss2Path}`)

    // ── 4. DOM 탐색 ────────────────────────────────────────────────
    section('4. DOM 구조 탐색')

    const domInfo = await ozPage.evaluate(() => {
      const KEYWORDS = ['인쇄','출력','프린트','print','Print','저장','save','Save','PDF','pdf','export','Export','download','Download']
      const isVisible = el => {
        if (!el) return false
        const rect = el.getBoundingClientRect()
        const style = window.getComputedStyle(el)
        return rect.width > 0 && rect.height > 0 &&
               style.display !== 'none' && style.visibility !== 'hidden' &&
               style.opacity !== '0'
      }

      const elInfo = el => {
        const attrs = {}
        for (const a of el.attributes) attrs[a.name] = a.value
        return {
          tag:       el.tagName,
          type:      el.type ?? '',
          id:        el.id ?? '',
          name:      el.name ?? '',
          className: el.className ?? '',
          value:     el.value ?? '',
          text:      (el.textContent ?? '').trim().slice(0, 80),
          title:     el.title ?? '',
          alt:       el.alt ?? '',
          ariaLabel: el.getAttribute('aria-label') ?? '',
          src:       el.src ?? '',
          href:      el.href ?? '',
          onclick:   el.getAttribute('onclick')?.slice(0, 120) ?? '',
          disabled:  el.disabled ?? false,
          visible:   isVisible(el),
          attrs,
        }
      }

      const hasKeyword = el => {
        const s = JSON.stringify(elInfo(el)).toLowerCase()
        return KEYWORDS.some(k => s.includes(k.toLowerCase()))
      }

      return {
        title:       document.title,
        url:         location.href,
        bodyPreview: (document.body?.innerText ?? '').slice(0, 3000),

        iframes:  Array.from(document.querySelectorAll('iframe')).map(e => ({
          id: e.id, name: e.name, src: e.src, className: e.className,
          width: e.width, height: e.height, visible: isVisible(e),
        })),
        objects:  Array.from(document.querySelectorAll('object,embed')).map(e => ({
          tag: e.tagName, type: e.type ?? '', data: e.data ?? '', src: e.src ?? '',
          id: e.id, className: e.className, visible: isVisible(e),
        })),
        canvases: Array.from(document.querySelectorAll('canvas')).map(e => ({
          id: e.id, className: e.className, width: e.width, height: e.height,
        })),

        buttons:  Array.from(document.querySelectorAll('button,input[type=button],input[type=submit],input[type=image]')).map(elInfo),
        inputs:   Array.from(document.querySelectorAll('input:not([type=button]):not([type=submit]):not([type=image])')).map(elInfo),
        imgs:     Array.from(document.querySelectorAll('img')).map(elInfo),
        anchors:  Array.from(document.querySelectorAll('a')).map(elInfo),

        keywordButtons: Array.from(document.querySelectorAll('button,input[type=button],input[type=submit],input[type=image],a,img')).filter(hasKeyword).map(elInfo),
      }
    }).catch(e => ({ error: String(e) }))

    // ── 5. 결과 출력 ───────────────────────────────────────────────
    section('5. 탐색 결과')

    console.log(`\n  document.title : ${C.cyan(domInfo.title ?? '')}`)
    console.log(`  current URL    : ${C.cyan(domInfo.url ?? '')}`)

    sep()
    console.log(C.bold('  body.innerText (앞 1000자):'))
    const preview = (domInfo.bodyPreview ?? '').slice(0, 1000)
    console.log(C.gray(preview.split('\n').map(l => '    ' + l).join('\n')))

    sep()
    const iframes = domInfo.iframes ?? []
    console.log(`\n  iframe 수: ${C.cyan(iframes.length)}`)
    iframes.forEach((f, i) => console.log(`    [${i}] id="${f.id}" name="${f.name}" src="${f.src}" visible=${f.visible}`))

    const objects = domInfo.objects ?? []
    console.log(`\n  object/embed 수: ${C.cyan(objects.length)}`)
    objects.forEach((o, i) => console.log(`    [${i}] <${o.tag}> type="${o.type}" data="${o.data}" visible=${o.visible}`))

    const canvases = domInfo.canvases ?? []
    console.log(`\n  canvas 수: ${C.cyan(canvases.length)}`)
    canvases.forEach((c, i) => console.log(`    [${i}] id="${c.id}" ${c.width}x${c.height}`))

    sep()
    const buttons = domInfo.buttons ?? []
    console.log(`\n  button/input[type=button/submit/image] 수: ${C.cyan(buttons.length)}`)
    buttons.forEach((b, i) => {
      const txt = [b.text, b.value, b.title, b.alt].filter(Boolean).join(' / ')
      console.log(`    [${i}] <${b.tag}> id="${b.id}" type="${b.type}" text="${txt}" onclick="${b.onclick.slice(0,60)}" visible=${b.visible}`)
    })

    const anchors = domInfo.anchors ?? []
    console.log(`\n  a 요소 수: ${C.cyan(anchors.length)}`)
    anchors.forEach((a, i) => {
      const txt = [a.text, a.title].filter(Boolean).join(' / ')
      console.log(`    [${i}] href="${a.href.slice(0,80)}" text="${txt}" onclick="${a.onclick.slice(0,60)}"`)
    })

    const imgs = domInfo.imgs ?? []
    console.log(`\n  img 수: ${C.cyan(imgs.length)}`)
    imgs.forEach((img, i) => {
      if (img.src || img.alt) console.log(`    [${i}] src="${img.src.slice(0,80)}" alt="${img.alt}" onclick="${img.onclick.slice(0,60)}" visible=${img.visible}`)
    })

    sep()
    const kwBtn = domInfo.keywordButtons ?? []
    console.log(`\n${C.bold('  ★ 인쇄/저장/PDF 키워드 버튼 후보:')} (${kwBtn.length}건)`)
    if (kwBtn.length === 0) {
      warn('키워드 버튼 후보 없음')
    } else {
      kwBtn.forEach((b, i) => {
        const txt = [b.text, b.value, b.title, b.alt, b.ariaLabel].filter(Boolean).join(' | ')
        const sel = b.id ? `#${b.id}` : b.className ? `.${b.className.split(' ')[0]}` : b.tag
        found(`[${i}] <${b.tag}> selector="${sel}" text="${txt}" onclick="${b.onclick.slice(0,80)}" visible=${b.visible}`)
      })
    }

    // ── 6. iframe 내부 탐색 ────────────────────────────────────────
    if (iframes.length > 0) {
      section('6. iframe 내부 DOM 탐색')
      for (let i = 0; i < iframes.length; i++) {
        const frameEl = iframes[i]
        try {
          const frame = ozPage.frame({ name: frameEl.name }) ??
                        ozPage.frames().find(f => f.url().includes(frameEl.src?.split('/').pop() ?? '__'))
          if (!frame) { warn(`iframe[${i}] 접근 불가 (크로스오리진 또는 이름 없음)`); continue }
          info(`iframe[${i}] URL: ${frame.url()}`)

          const iframeKw = await frame.evaluate(() => {
            const KEYWORDS = ['인쇄','출력','프린트','print','Print','저장','save','Save','PDF','pdf']
            const isVisible = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
            const elInfo = el => ({
              tag: el.tagName, id: el.id, text: (el.textContent ?? '').trim().slice(0, 60),
              onclick: el.getAttribute('onclick')?.slice(0, 100) ?? '',
              src: el.src ?? '', alt: el.alt ?? '', visible: isVisible(el),
            })
            const hasKw = el => {
              const s = JSON.stringify(elInfo(el)).toLowerCase()
              return KEYWORDS.some(k => s.includes(k.toLowerCase()))
            }
            return {
              title: document.title,
              buttons: Array.from(document.querySelectorAll('button,input[type=button],input[type=image],a,img')).filter(hasKw).map(elInfo),
              all: Array.from(document.querySelectorAll('button,input[type=button],input[type=image]')).map(elInfo),
              canvases: Array.from(document.querySelectorAll('canvas')).length,
              objects: Array.from(document.querySelectorAll('object,embed')).length,
              iframes: Array.from(document.querySelectorAll('iframe')).length,
            }
          }).catch(() => null)

          if (iframeKw) {
            info(`  title: ${iframeKw.title}`)
            info(`  canvas: ${iframeKw.canvases}  object/embed: ${iframeKw.objects}  nested iframe: ${iframeKw.iframes}`)
            info(`  전체 버튼: ${iframeKw.all?.length ?? 0}건`)
            if (iframeKw.buttons?.length > 0) {
              found(`  키워드 버튼 ${iframeKw.buttons.length}건:`)
              iframeKw.buttons.forEach((b, j) => {
                const txt = [b.text, b.alt].filter(Boolean).join(' | ')
                found(`    [${j}] <${b.tag}> id="${b.id}" text="${txt}" onclick="${b.onclick}" src="${b.src.slice(0,60)}"`)
              })
            } else {
              warn('  iframe 내 키워드 버튼 없음')
            }
          }
        } catch (e) {
          warn(`iframe[${i}] 탐색 오류: ${e.message}`)
        }
      }
    }

    // ── 7. window 함수 탐색 ────────────────────────────────────────
    section('7. window 전역 함수 탐색 (인쇄/저장 관련)')
    const winFuncs = await ozPage.evaluate(() => {
      const KEYWORDS = ['print','Print','save','Save','pdf','PDF','export','Export','report','Report','oz','OZ','viewer','Viewer','download']
      return Object.keys(window).filter(k => {
        if (typeof window[k] !== 'function') return false
        return KEYWORDS.some(kw => k.toLowerCase().includes(kw.toLowerCase()))
      })
    }).catch(() => [])
    info(`관련 window 함수: ${winFuncs.length}건`)
    if (winFuncs.length > 0) winFuncs.forEach(f => found(`  window.${f}`))
    else warn('인쇄/저장 관련 window 함수 없음')

    // ── 8. 최종 스크린샷 ─────────────────────────────────────────
    const ss3Path = path.join(ssDir, 'oz_final.png')
    await ozPage.screenshot({ path: ss3Path, fullPage: true })
    info(`최종 스크린샷: ${ss3Path}`)

    // ── 9. 종합 판단 보고 ─────────────────────────────────────────
    section('9. 종합 판단 및 권고')

    const hasCanvas  = (domInfo.canvases?.length ?? 0) > 0
    const hasObject  = (domInfo.objects?.length ?? 0) > 0
    const hasIframe  = (domInfo.iframes?.length ?? 0) > 0
    const hasKwBtn   = (domInfo.keywordButtons?.length ?? 0) > 0
    const hasWinFunc = winFuncs.length > 0

    console.log()
    console.log(`  OZ Viewer 로딩 완료 여부       : ${C.cyan(loadingGone ? 'YES' : 'NO (타임아웃)')}`)
    console.log(`  iframe 존재                    : ${C.cyan(hasIframe ? `YES (${domInfo.iframes.length}개)` : 'NO')}`)
    console.log(`  canvas 존재                    : ${C.cyan(hasCanvas ? `YES (${domInfo.canvases.length}개)` : 'NO')}`)
    console.log(`  object/embed 존재              : ${C.cyan(hasObject ? `YES (${domInfo.objects.length}개)` : 'NO')}`)
    console.log(`  DOM 버튼 키워드 후보            : ${C.cyan(hasKwBtn ? `YES (${domInfo.keywordButtons.length}건)` : 'NO')}`)
    console.log(`  window 함수 후보               : ${C.cyan(hasWinFunc ? `YES (${winFuncs.length}건)` : 'NO')}`)

    sep()
    console.log(C.bold('\n  PDF 저장 자동화 가능성 판단:'))

    if (hasCanvas && !hasKwBtn) {
      warn('OZ Viewer는 canvas 기반 렌더링으로 DOM 버튼 직접 접근 불가')
      warn('→ CDP Page.printToPDF 또는 화면 캡처 방식 검토 필요')
    }
    if (hasIframe && !hasKwBtn) {
      warn('iframe 내부에 버튼이 있을 수 있음 — 크로스오리진 여부 확인 필요')
    }
    if (hasKwBtn) {
      found('DOM 버튼 후보 발견 — 클릭 자동화 가능성 있음')
    }
    if (hasWinFunc) {
      found('window 함수 후보 발견 — evaluate() 호출 시도 가능')
    }
    if (!hasCanvas && !hasObject && !hasIframe) {
      info('일반 HTML 페이지로 추정 — page.waitForLoadState 후 pdf() 재검토')
    }

    sep()
    console.log(C.bold('\n  추천 다음 단계:'))
    console.log('   1. 로딩 완료 감지 조건 개선 (body text 변화, networkidle 등 복합 사용)')
    console.log('   2. OZ Viewer 로딩 완료 후 CDP Page.printToPDF 시도')
    console.log('   3. window 함수 중 OZ print/export 함수 직접 호출 탐색')
    console.log('   4. OZ Viewer가 iframe 내에 렌더링되면 해당 frame을 대상으로 pdf() 시도')
    console.log('   5. 자동화 불가 시 — 브라우저 창만 열고 사용자가 수동 인쇄/저장 안내')
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
    console.error(err.stack)
    process.exit(1)
  })
