/**
 * OZ Viewer → 저장 → select PDF → 확인 → 다운로드 테스트
 *
 * 발견 사항:
 *   저장 패널은 <select> + 확인/취소 버튼 구조임
 *   select 요소에서 "Adobe PDF File(*.pdf)" 를 selectOption() 한 뒤
 *   "확인" 버튼을 클릭하면 다운로드가 발생할 것으로 예상
 *
 * 실행: npx electron test_oz_save_pdf2.js
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
    const body = await page.evaluate(() => document.body?.innerText ?? '').catch(() => '')
    if (!OZ_LOADING_TEXTS.some(t => body.includes(t))) {
      await page.waitForTimeout(3000)
      return { done: true, bodyText: await page.evaluate(() => document.body?.innerText ?? '') }
    }
    info(`[${elapsed/1000}s] OZ 로딩 중...`)
  }
  return { done: false, bodyText: '' }
}

async function main() {
  console.log(C.bold('\n══════════════════════════════════════════════'))
  console.log(C.bold('  OZ Viewer → 저장 → selectOption(PDF) → 확인 → 다운로드'))
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
    selectFound: false, selectSelector: '',
    pdfOptionFound: false,
    confirmBtnFound: false, confirmBtnSelector: '',
    downloadFired: false,
    downloadFilename: '', downloadExt: '', downloadSize: 0, savedPath: '',
    dialogFired: false, newPageFired: false,
  }

  try {
    // ── 로그인 ────────────────────────────────────────────────────
    section('1. 로그인')
    bSession = await browser.launchBrowser(ssDir)
    const { page: mainPage, context } = bSession
    const lr = await browser.loginToever(mainPage, TOEVER_ID, TOEVER_PW)
    if (!lr.success) throw new Error(`로그인 실패: ${lr.error}`)
    info('로그인 성공')

    // ── 발주번호 추출 ──────────────────────────────────────────────
    section('2. 발주번호 추출')
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

    // ── OZ Viewer 열기 ─────────────────────────────────────────────
    section('3. OZ Viewer 열기 + 로딩 대기')
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
    const lr2 = await waitOZLoad(ozPage)
    found(`OZ 로딩 완료: ${lr2.done}`)
    info(`body 앞 100자: ${(lr2.bodyText ?? '').slice(0, 100).replace(/\n/g,' ')}`)

    // ── 저장 버튼 클릭 → 패널 오픈 ───────────────────────────────
    section('4. 저장 버튼 클릭 → 패널 구조 탐색')
    await ozPage.click('input[type=image][alt="저장"]', { timeout: 5000 }).catch(e => warn(`저장 클릭 오류: ${e.message}`))
    await ozPage.waitForTimeout(1500)

    // 패널 내 select/input 구조 탐색
    const panelStructure = await ozPage.evaluate(() => {
      const selects = Array.from(document.querySelectorAll('select')).map(sel => ({
        id: sel.id, name: sel.name, cls: sel.className,
        options: Array.from(sel.options).map(o => ({ value: o.value, text: o.text, index: o.index })),
        visible: (() => { const r = sel.getBoundingClientRect(); return r.width > 0 && r.height > 0 })(),
      }))
      const inputs = Array.from(document.querySelectorAll('input[type=button],input[type=submit],button'))
        .map(el => ({
          tag: el.tagName, type: el.type, value: el.value ?? '', text: el.textContent?.trim() ?? '',
          id: el.id, cls: el.className,
          visible: (() => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 })(),
          onclick: el.getAttribute('onclick')?.slice(0, 100) ?? '',
        }))
      const links = Array.from(document.querySelectorAll('a')).filter(a => {
        const t = a.textContent?.trim() ?? ''
        return t === '확인' || t === '취소' || t === 'Close'
      }).map(a => ({ text: a.textContent?.trim(), href: a.href, onclick: a.getAttribute('onclick')?.slice(0, 80) ?? '' }))
      return { selects, inputs, links }
    }).catch(() => ({ selects: [], inputs: [], links: [] }))

    info(`select 요소 (${panelStructure.selects?.length ?? 0}건):`)
    panelStructure.selects?.forEach((s, i) => {
      info(`  [${i}] id="${s.id}" name="${s.name}" cls="${s.cls?.slice(0,30)}" visible=${s.visible}`)
      s.options?.forEach(o => info(`       option[${o.index}] value="${o.value}" text="${o.text}"`) )
    })
    info(`button/input (${panelStructure.inputs?.length ?? 0}건):`)
    panelStructure.inputs?.forEach((b, i) =>
      info(`  [${i}] <${b.tag} type=${b.type}> value="${b.value}" text="${b.text}" onclick="${b.onclick}" visible=${b.visible}`)
    )
    info(`a 링크 (${panelStructure.links?.length ?? 0}건):`)
    panelStructure.links?.forEach((l, i) =>
      info(`  [${i}] text="${l.text}" onclick="${l.onclick}" href="${l.href}"`)
    )

    await ozPage.screenshot({ path: `${ssDir}/ozpdf2_after_save_click.png`, fullPage: true })

    // ── select PDF 선택 ─────────────────────────────────────────
    section('5. select → PDF 옵션 선택 → 확인 클릭')

    const selectEl = panelStructure.selects?.find(s => s.visible || s.options?.some(o => o.text.includes('PDF')))
    if (selectEl) {
      R.selectFound    = true
      R.selectSelector = selectEl.id ? `#${selectEl.id}` : `select[name="${selectEl.name}"]`
      const pdfOpt = selectEl.options?.find(o => o.text.includes('PDF') || o.text.includes('pdf'))
      R.pdfOptionFound = !!pdfOpt
      found(`select: ${R.selectSelector}  PDF option: "${pdfOpt?.text ?? '없음'}" value="${pdfOpt?.value ?? ''}"`)

      if (pdfOpt) {
        // selectOption
        try {
          await ozPage.selectOption(R.selectSelector, { value: pdfOpt.value }, { timeout: 5000 }).catch(async () => {
            // visible 아닐 경우 JS로 강제 설정
            await ozPage.evaluate((sel, val) => {
              const el = document.querySelector(sel)
              if (el) { el.value = val; el.dispatchEvent(new Event('change', { bubbles: true })) }
            }, R.selectSelector, pdfOpt.value)
          })
          info(`select → PDF 선택 완료 (value="${pdfOpt.value}")`)
        } catch (e) {
          warn(`selectOption 오류: ${e.message}`)
        }

        // 확인 버튼 찾기
        const confirmBtn = panelStructure.inputs?.find(b => b.value === '확인' || b.text === '확인')
          ?? panelStructure.links?.find(l => l.text === '확인')
        if (confirmBtn) {
          R.confirmBtnFound    = true
          R.confirmBtnSelector = confirmBtn.id ? `#${confirmBtn.id}` : ''
          found(`확인 버튼: value="${confirmBtn.value ?? confirmBtn.text}" onclick="${confirmBtn.onclick}"`)
        } else {
          warn('확인 버튼을 DOM 탐색에서 찾지 못함 — getByText 시도')
        }

        // download 이벤트 준비
        let dlEvent = null
        ozPage.once('download', dl => { dlEvent = dl })
        const dlPromise = ozPage.waitForEvent('download', { timeout: 20000 }).catch(() => null)
        const popupPromise = context.waitForEvent('page', { timeout: 10000 }).catch(() => null)

        // 확인 버튼 클릭
        let confirmed = false
        if (R.confirmBtnSelector) {
          try {
            await ozPage.click(R.confirmBtnSelector, { timeout: 5000 })
            confirmed = true
            info(`selector 클릭: ${R.confirmBtnSelector}`)
          } catch (e) { warn(`selector 클릭 오류: ${e.message}`) }
        }
        if (!confirmed) {
          try {
            await ozPage.getByText('확인', { exact: true }).first().click({ timeout: 5000 })
            confirmed = true
            info('getByText("확인") 클릭')
          } catch (e) {
            // JS evaluate로 클릭
            try {
              await ozPage.evaluate(() => {
                const all = Array.from(document.querySelectorAll('*'))
                const btn = all.find(el =>
                  (el.tagName === 'INPUT' || el.tagName === 'BUTTON' || el.tagName === 'A') &&
                  (el.value === '확인' || el.textContent?.trim() === '확인')
                )
                if (btn) btn.click()
              })
              confirmed = true
              info('JS evaluate → 확인 클릭')
            } catch (e2) { warn(`확인 클릭 실패: ${e2.message}`) }
          }
        }

        if (confirmed) {
          info('확인 클릭 완료 — 다운로드 대기 (최대 20초)...')
          await ozPage.screenshot({ path: `${ssDir}/ozpdf2_after_confirm.png`, fullPage: true })

          const dl    = dlEvent ?? await dlPromise
          const popup = await popupPromise

          if (dl) {
            R.downloadFired    = true
            R.downloadFilename = dl.suggestedFilename()
            R.downloadExt      = path.extname(dl.suggestedFilename()).toLowerCase()
            const ts       = Date.now()
            const saveName = `oz_pdf_${TEST_DATE.replace(/-/g,'')}_${ts}${R.downloadExt || '.pdf'}`
            const savePath = path.join(pdfDir, saveName)
            await dl.saveAs(savePath)
            if (fs.existsSync(savePath)) {
              R.downloadSize = fs.statSync(savePath).size
              R.savedPath    = savePath
            }
            found(`다운로드 성공: "${R.downloadFilename}"`)
            found(`확장자: ${R.downloadExt}  크기: ${R.downloadSize.toLocaleString()} bytes`)
            found(`저장 경로: ${R.savedPath}`)
          } else {
            warn('download 이벤트 없음 (20초 대기 후 타임아웃)')
          }

          if (popup) {
            R.newPageFired = true
            found(`새 탭/팝업: ${popup.url()}`)
            await popup.screenshot({ path: `${ssDir}/ozpdf2_popup.png` })
            await popup.close().catch(() => {})
          }

          await ozPage.waitForTimeout(2000)
          const bodyFinal = await ozPage.evaluate(() => document.body?.innerText ?? '').catch(() => '')
          info(`확인 후 body (앞 300자): ${bodyFinal.slice(0, 300).replace(/\n/g,' ')}`)
          await ozPage.screenshot({ path: `${ssDir}/ozpdf2_final.png`, fullPage: true })
        }
      }
    } else {
      warn('select 요소 없음 — 저장 패널 구조가 예상과 다름')
    }

  } catch (err) {
    warn(`오류: ${err.message}`)
    console.error(err.stack)
  } finally {
    if (bSession) { info('브라우저 종료...'); await browser.closeBrowser() }
  }

  // ── 보고 ─────────────────────────────────────────────────────
  section('보고')
  const row = (no, label, value, ok) => {
    const mark = ok === undefined ? '  ' : ok ? C.green(' ✓') : C.red(' ✗')
    const v    = !value && value !== 0 ? C.gray('(없음)') : C.cyan(String(value))
    console.log(`${mark}  ${C.bold(String(no).padStart(2) + '.')} ${label.padEnd(38)} ${v}`)
  }
  console.log()
  row( 1, 'select 요소 발견',              R.selectFound ? R.selectSelector : 'NO', R.selectFound)
  row( 2, 'PDF option 발견',               R.pdfOptionFound ? 'YES' : 'NO', R.pdfOptionFound)
  row( 3, '확인 버튼 발견',                R.confirmBtnFound ? R.confirmBtnSelector || 'YES' : 'NO', R.confirmBtnFound)
  row( 4, 'download 이벤트 발생',          R.downloadFired ? 'YES' : 'NO', R.downloadFired)
  row( 5, '팝업/새탭 발생',                R.newPageFired ? 'YES' : 'NO', undefined)
  row( 6, 'alert/dialog 발생',             R.dialogFired ? 'YES' : 'NO', undefined)
  row( 7, '다운로드 파일명',               R.downloadFilename, undefined)
  row( 8, '다운로드 파일 확장자',          R.downloadExt, R.downloadFired ? R.downloadExt === '.pdf' : undefined)
  row( 9, '다운로드 파일 크기',            R.downloadSize > 0 ? `${R.downloadSize.toLocaleString()} bytes` : '0', R.downloadFired ? R.downloadSize > 0 : undefined)
  row(10, '저장 경로',                     R.savedPath, undefined)
  row(11, 'page.pdf() 방식',               R.downloadFired ? '폐기 가능 (OZ 저장→PDF 방식 채택)' : '유지 필요 (OZ 방식 미확인)', undefined)
  console.log()
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(C.red('\n[FATAL] ' + err.message))
    console.error(err.stack)
    process.exit(1)
  })
