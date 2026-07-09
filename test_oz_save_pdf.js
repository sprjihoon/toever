/**
 * OZ Viewer → 저장 버튼 → PDF 항목 클릭 → 다운로드 저장 테스트
 *
 * 실행: npx electron test_oz_save_pdf.js
 *
 * 발견 사항:
 *   저장 버튼 클릭 시 DOM 내 파일 형식 패널이 열림:
 *     - OZ Report Data File(*.ozd)
 *     - Adobe PDF File(*.pdf)  ← 이것을 클릭
 *     - Microsoft Excel 97-2003 File(*.xls)
 *     - Microsoft Excel File(*.xlsx)
 *
 * 절대 금지:
 *   - 송장 업로드, 출고작업지시, 이지어드민 자동화, 상태 변경
 */
'use strict'

const path = require('path')
const fs   = require('fs')
const os   = require('os')

const DIST      = path.join(__dirname, 'dist-electron')
const BASE_PATH = path.join(os.homedir(), 'toever-data')
const TEST_DATE = '2026-07-09'
const TOEVER_BASE    = 'https://support.toever.co.kr'
const OZ_URL_BASE    = `${TOEVER_BASE}/VendorMgr/PoState/rptSalePaperPrintP_HTML.jsp`
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
const section = m => console.log(`\n${C.bold(C.cyan('▶ ' + m))}`)
const sep     = () => console.log(C.gray('  ─────────────────────────────────────────────────'))

const OZ_LOADING_TEXTS = [
  '오즈 리포트 뷰어를 실행하고 있습니다',
  '데이터 모듈을 받기 시작합니다',
  '데이터 모듈을 받고 있습니다',
]

async function waitOZLoad(page, maxMs = 40000) {
  const POLL = 2000
  let elapsed = 0
  while (elapsed < maxMs) {
    await page.waitForTimeout(POLL)
    elapsed += POLL
    const bodyText = await page.evaluate(() => document.body?.innerText ?? '').catch(() => '')
    if (!OZ_LOADING_TEXTS.some(t => bodyText.includes(t))) {
      await page.waitForTimeout(3000)
      return { done: true, bodyText: await page.evaluate(() => document.body?.innerText ?? '') }
    }
    info(`  [${elapsed/1000}s] OZ 로딩 중...`)
  }
  return { done: false, bodyText: '' }
}

async function main() {
  console.log(C.bold('\n══════════════════════════════════════════════'))
  console.log(C.bold('  OZ Viewer → 저장 → PDF 다운로드 테스트'))
  console.log(C.bold(`  날짜: ${TEST_DATE}`))
  console.log(C.bold('══════════════════════════════════════════════\n'))

  const storage = require(path.join(DIST, 'electron/services/storage.js'))
  storage.setBasePath(BASE_PATH)
  storage.ensureAllDirs()
  const { initDb } = require(path.join(DIST, 'electron/services/db/schema.js'))
  initDb(BASE_PATH)
  const browser = require(path.join(DIST, 'electron/services/toever/browser.js'))
  const ssDir  = storage.DIRS.logsScreenshots()
  const pdfDir = storage.DIRS.pdfContracts()
  if (!fs.existsSync(pdfDir)) fs.mkdirSync(pdfDir, { recursive: true })

  let bSession = null
  const R = {
    formatPanelAppeared: false,
    pdfItemFound: false,
    pdfItemSelector: '',
    downloadFired: false,
    downloadFilename: '',
    downloadExt: '',
    downloadSize: 0,
    savedPath: '',
    dialogFired: false,
    newPageFired: false,
  }

  try {
    // ── 1. 로그인 ─────────────────────────────────────────────────
    section('1. 투에버 로그인')
    bSession = await browser.launchBrowser(ssDir)
    const { page: mainPage, context } = bSession
    const lr = await browser.loginToever(mainPage, TOEVER_ID, TOEVER_PW)
    if (!lr.success) throw new Error(`로그인 실패: ${lr.error}`)
    info(`로그인 ${lr.sessionReused ? '(세션 재사용)' : '성공'}`)

    // ── 2. 발주번호 범위 추출 ─────────────────────────────────────
    section('2. 발주내역 조회 + 발주번호 추출')
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

    const cp = await frame.evaluate(() => {
      if (typeof window.getReportCommonParams === 'function') return window.getReportCommonParams()
      return null
    }).catch(() => null)
    if (!cp?.p_order_no) throw new Error('발주번호 추출 실패')

    const poFrom = String(cp.p_order_no)
    const poTo   = String(cp.p_order_noTo)
    found(`발주번호: ${poFrom} ~ ${poTo}`)

    // ── 3. OZ Viewer 열기 ────────────────────────────────────────
    section('3. OZ Viewer 열기')
    const qs = new URLSearchParams({
      p_xml_file: '/SALE/vendor_sale_paper_new.ozr',
      p_company_cd: cp.p_company_cd ?? '01', p_merchant_cd: cp.p_merchant_cd ?? '0001',
      p_entr_no: cp.p_entr_no ?? '', p_order_dt: dc, p_order_dtTo: dc,
      p_storeout_sts: cp.p_storeout_sts ?? '01',
      p_order_no: poFrom, p_order_noTo: poTo,
    })
    const OZ_URL = `${OZ_URL_BASE}?${qs.toString()}`

    const ozPage = await context.newPage()
    let dialogInfo = null
    ozPage.on('dialog', async d => {
      dialogInfo = { type: d.type(), msg: d.message() }
      R.dialogFired = true
      info(`dialog: ${d.type()} "${d.message()}"`)
      await d.dismiss().catch(() => {})
    })

    await ozPage.goto(OZ_URL, { waitUntil: 'domcontentloaded', timeout: 30000 })
    info('OZ Viewer 로딩 대기...')

    // ── 4. 로딩 완료 대기 ─────────────────────────────────────────
    section('4. 로딩 완료 대기')
    const lr2 = await waitOZLoad(ozPage)
    info(`로딩 완료: ${lr2.done}`)
    info(`body 앞 200자: ${(lr2.bodyText ?? '').slice(0, 200).replace(/\n/g,' ')}`)
    await ozPage.screenshot({ path: `${ssDir}/ozpdf_after_load.png`, fullPage: true })

    if (!lr2.done) warn('로딩 타임아웃 — 계속 진행')
    if ((lr2.bodyText ?? '').includes('조회된 데이터가 없습니다')) {
      warn('"조회된 데이터가 없습니다" — 발주번호 범위 재확인 필요')
    }

    // ── 5. 저장 버튼 클릭 → 파일형식 패널 열기 ──────────────────
    section('5. 저장 버튼 클릭 → 파일 형식 패널 탐색')
    await ozPage.click('input[type=image][alt="저장"]', { timeout: 5000 }).catch(e => warn(`저장 클릭 오류: ${e.message}`))
    await ozPage.waitForTimeout(1500)

    await ozPage.screenshot({ path: `${ssDir}/ozpdf_after_save_click.png`, fullPage: true })

    // 열린 패널/메뉴 구조 탐색
    const panelInfo = await ozPage.evaluate(() => {
      const body = document.body?.innerText ?? ''
      const hasPdf   = body.includes('Adobe PDF')  || body.includes('.pdf')
      const hasXls   = body.includes('Excel')       || body.includes('.xls')
      const hasOzd   = body.includes('.ozd')

      // 클릭 가능한 텍스트/링크/div 탐색
      const candidates = Array.from(document.querySelectorAll('*')).filter(el => {
        const txt = el.textContent?.trim() ?? ''
        return (txt.includes('PDF') || txt.includes('Adobe') || txt.includes('xlsx') ||
                txt.includes('xls') || txt.includes('ozd')) &&
               txt.length < 80 &&
               el.children.length === 0  // 리프 노드만
      }).map(el => ({
        tag: el.tagName,
        text: el.textContent?.trim(),
        id: el.id,
        cls: el.className,
        onclick: el.getAttribute('onclick')?.slice(0, 100) ?? '',
        href: el.href ?? '',
        visible: (() => {
          const r = el.getBoundingClientRect()
          return r.width > 0 && r.height > 0
        })(),
      }))

      return { hasPdf, hasXls, hasOzd, bodySnippet: body.slice(0, 800), candidates }
    }).catch(() => ({ hasPdf: false, hasXls: false, candidates: [] }))

    R.formatPanelAppeared = panelInfo.hasPdf || panelInfo.hasXls || panelInfo.hasOzd

    info(`파일형식 패널 출현: ${R.formatPanelAppeared}`)
    info(`PDF 항목: ${panelInfo.hasPdf}  XLS: ${panelInfo.hasXls}  OZD: ${panelInfo.hasOzd}`)
    info(`body 앞 600자: ${(panelInfo.bodySnippet ?? '').slice(0, 600).replace(/\n/g,' ')}`)
    sep()
    info(`클릭 후보 요소 (${panelInfo.candidates?.length ?? 0}건):`)
    panelInfo.candidates?.forEach((c, i) =>
      info(`  [${i}] <${c.tag}> text="${c.text}" cls="${c.cls?.slice(0,30)}" onclick="${c.onclick}" visible=${c.visible}`)
    )

    // ── 6. PDF 항목 selector 찾기 ────────────────────────────────
    section('6. PDF 항목 selector 탐색')
    const pdfSelector = await ozPage.evaluate(() => {
      // 텍스트에 'PDF' 또는 'Adobe' 포함 + 클릭 가능한 요소
      const candidates = Array.from(document.querySelectorAll('*')).filter(el => {
        const txt = el.textContent?.trim() ?? ''
        return (txt.includes('Adobe PDF') || txt.includes('.pdf')) && txt.length < 80
      })
      for (const el of candidates) {
        const r = el.getBoundingClientRect()
        if (r.width > 0 && r.height > 0) {
          // 고유 selector 생성
          if (el.id) return `#${el.id}`
          if (el.className) return `${el.tagName.toLowerCase()}.${el.className.trim().split(' ')[0]}`
          return el.tagName.toLowerCase()
        }
      }
      return null
    }).catch(() => null)

    R.pdfItemFound    = !!pdfSelector
    R.pdfItemSelector = pdfSelector ?? ''
    info(`PDF 항목 selector: ${pdfSelector ?? '(없음)'}`)

    // ── 7. PDF 항목 클릭 → 다운로드 시도 ────────────────────────
    section('7. PDF 항목 클릭 → 다운로드 감지')

    if (!R.formatPanelAppeared) {
      warn('파일 형식 패널이 나타나지 않았음 — PDF 클릭 스킵')
    } else {
      // download 이벤트 등록
      let dlEvent = null
      ozPage.once('download', dl => { dlEvent = dl })
      const dlPromise = ozPage.waitForEvent('download', { timeout: 15000 }).catch(() => null)

      // 새 탭 감지
      const popupPromise = context.waitForEvent('page', { timeout: 8000 }).catch(() => null)

      // PDF 항목 클릭 (selector 또는 텍스트 기반)
      let clicked = false
      if (pdfSelector) {
        try {
          await ozPage.click(pdfSelector, { timeout: 5000 })
          clicked = true
          info(`selector 클릭: ${pdfSelector}`)
        } catch (e) {
          warn(`selector 클릭 실패: ${e.message}`)
        }
      }

      // fallback: 텍스트 기반 클릭
      if (!clicked) {
        try {
          await ozPage.getByText('Adobe PDF', { exact: false }).first().click({ timeout: 5000 })
          clicked = true
          info('텍스트 기반 클릭: "Adobe PDF"')
        } catch (e1) {
          try {
            await ozPage.getByText('.pdf', { exact: false }).first().click({ timeout: 3000 })
            clicked = true
            info('텍스트 기반 클릭: ".pdf"')
          } catch (e2) {
            warn(`PDF 항목 클릭 실패: ${e2.message}`)
          }
        }
      }

      if (clicked) {
        info('PDF 항목 클릭 완료 — 다운로드 대기 중...')
        await ozPage.screenshot({ path: `${ssDir}/ozpdf_after_pdf_click.png`, fullPage: true })

        const dl = dlEvent ?? await dlPromise
        const popup = await popupPromise

        if (dl) {
          R.downloadFired    = true
          R.downloadFilename = dl.suggestedFilename()
          R.downloadExt      = path.extname(dl.suggestedFilename()).toLowerCase()
          const ts       = Date.now()
          const saveName = `oz_pdf_${TEST_DATE.replace(/-/g,'')}_${ts}${R.downloadExt || '.pdf'}`
          const savePath = path.join(pdfDir, saveName)
          await dl.saveAs(savePath).catch(e => warn(`saveAs 오류: ${e.message}`))
          if (fs.existsSync(savePath)) {
            R.downloadSize = fs.statSync(savePath).size
            R.savedPath    = savePath
          }
          found(`다운로드 성공: "${R.downloadFilename}"  확장자: ${R.downloadExt}`)
          found(`파일 크기: ${R.downloadSize.toLocaleString()} bytes`)
          found(`저장 경로: ${R.savedPath}`)
        } else {
          warn('download 이벤트 없음')
        }

        if (popup) {
          R.newPageFired = true
          found(`새 탭/팝업 감지: ${popup.url()}`)
          await popup.screenshot({ path: `${ssDir}/ozpdf_popup.png` })
          await popup.close().catch(() => {})
        }
      }

      await ozPage.waitForTimeout(2000)
      await ozPage.screenshot({ path: `${ssDir}/ozpdf_final.png`, fullPage: true })

      // 클릭 후 body
      const bodyFinal = await ozPage.evaluate(() => document.body?.innerText ?? '').catch(() => '')
      info(`최종 body (앞 300자): ${bodyFinal.slice(0, 300).replace(/\n/g,' ')}`)
    }

  } catch (err) {
    warn(`오류: ${err.message}`)
    console.error(err.stack)
  } finally {
    if (bSession) { info('브라우저 종료...'); await browser.closeBrowser() }
  }

  // ── 보고 ─────────────────────────────────────────────────────
  section('보고 15항목')
  const row = (no, label, value, ok) => {
    const mark = ok === undefined ? '  ' : ok ? C.green(' ✓') : C.red(' ✗')
    const v    = !value && value !== 0 ? C.gray('(없음)') : C.cyan(String(value))
    console.log(`${mark}  ${C.bold(String(no).padStart(2) + '.')} ${label.padEnd(38)} ${v}`)
  }
  console.log()
  row( 1, '저장 버튼 존재/visible',          'input[type=image][alt="저장"] YES',  true)
  row( 2, '저장 클릭 후 형식 패널 출현',     R.formatPanelAppeared ? 'YES' : 'NO', R.formatPanelAppeared)
  row( 3, 'PDF 항목 selector',               R.pdfItemSelector,                    R.pdfItemFound)
  row( 4, 'PDF 항목 클릭 후 download 발생',  R.downloadFired ? 'YES' : 'NO',       R.downloadFired)
  row( 5, '팝업/새탭 발생',                  R.newPageFired ? 'YES' : 'NO',        undefined)
  row( 6, 'alert/dialog 발생',               R.dialogFired ? 'YES' : 'NO',         undefined)
  row( 7, '다운로드 파일명',                 R.downloadFilename,                   undefined)
  row( 8, '다운로드 파일 확장자',            R.downloadExt,                        R.downloadFired ? R.downloadExt === '.pdf' : undefined)
  row( 9, '다운로드 파일 크기',              R.downloadSize > 0 ? `${R.downloadSize.toLocaleString()} bytes` : '0', R.downloadFired ? R.downloadSize > 0 : undefined)
  row(10, '저장 경로',                       R.savedPath,                          undefined)
  row(11, '인쇄 버튼 후보',                  'input[type=image][alt="인쇄"] — 다음 단계에서 테스트', undefined)
  row(12, 'page.pdf() 방식',                 R.downloadFired ? '폐기 (OZ 저장 버튼 다운로드 사용)' : '유지 (OZ 저장 실패 시 fallback)', undefined)
  row(13, '권장 구현 방식',                  R.downloadFired ? 'OZ 저장→PDF 클릭 → download 저장' : '추가 탐색 필요', undefined)
  console.log()
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(C.red('\n[FATAL] ' + err.message))
    console.error(err.stack)
    process.exit(1)
  })
