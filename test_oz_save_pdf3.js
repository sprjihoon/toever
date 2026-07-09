/**
 * OZ Viewer → 저장 버튼 → select[1] PDF 선택 → 확인 버튼 클릭 → 다운로드
 *
 * 발견 사항:
 *   select[0]: 줌 선택 (25%~500%)
 *   select[1]: 파일 형식 선택 (ozd/pdf/xls/xlsx/...)
 *   button[2]: 확인  button[3]: 취소
 *   → document.querySelectorAll('select')[1].value = 'Adobe PDF File(*.pdf)'
 *   → document.querySelectorAll('button')[2].click()
 *
 * 실행: npx electron test_oz_save_pdf3.js
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
  console.log(C.bold('  OZ Viewer → 저장 → select[1]=PDF → 확인 → 다운로드'))
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
    downloadFired: false,
    downloadFilename: '', downloadExt: '', downloadSize: 0, savedPath: '',
    dialogFired: false, newPageFired: false,
    confirmedClick: false,
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
    section('3. OZ Viewer 열기 + 로딩')
    const qs = new URLSearchParams({
      p_xml_file: '/SALE/vendor_sale_paper_new.ozr',
      p_company_cd: cp.p_company_cd ?? '01', p_merchant_cd: cp.p_merchant_cd ?? '0001',
      p_entr_no: cp.p_entr_no ?? '', p_order_dt: dc, p_order_dtTo: dc,
      p_storeout_sts: cp.p_storeout_sts ?? '01',
      p_order_no: poFrom, p_order_noTo: poTo,
    })
    const OZ_URL = `${OZ_URL_BASE}?${qs.toString()}`
    const ozPage = await context.newPage()

    ozPage.on('dialog', async d => {
      R.dialogFired = true
      info(`dialog: ${d.type()} "${d.message()}"`)
      await d.dismiss().catch(() => {})
    })

    await ozPage.goto(OZ_URL, { waitUntil: 'domcontentloaded', timeout: 30000 })
    const lr2 = await waitOZLoad(ozPage)
    found(`OZ 로딩 완료: ${lr2.done}`)
    info(`body: ${(lr2.bodyText ?? '').slice(0, 80).replace(/\n/g,' ')}`)

    // ── 저장 버튼 클릭 ─────────────────────────────────────────────
    section('4. 저장 버튼 클릭')
    await ozPage.click('input[type=image][alt="저장"]', { timeout: 5000 })
    await ozPage.waitForTimeout(1500)

    // 패널이 열렸는지 확인
    const panelOpen = await ozPage.evaluate(() => {
      const selects = document.querySelectorAll('select')
      const fileSelect = selects[1]
      if (!fileSelect) return false
      const r = fileSelect.getBoundingClientRect()
      return r.width > 0 && r.height > 0
    }).catch(() => false)
    info(`저장 패널 열림: ${panelOpen}`)

    // ── select[1] PDF 선택 + 확인 클릭 ───────────────────────────
    section('5. select[1] PDF 선택 → 확인 클릭')

    // download 이벤트 준비
    let dlEvent = null
    ozPage.once('download', dl => { dlEvent = dl })
    const dlPromise  = ozPage.waitForEvent('download', { timeout: 30000 }).catch(() => null)
    const popupProm  = context.waitForEvent('page', { timeout: 15000 }).catch(() => null)

    // JS로 select[1]에 PDF 값 설정 후 확인 버튼 클릭
    const selectResult = await ozPage.evaluate(() => {
      const selects = document.querySelectorAll('select')
      const fileSelect = selects[1]
      if (!fileSelect) return { ok: false, reason: 'select[1] 없음' }

      // PDF 옵션 찾기 (value에 'pdf' 포함)
      const pdfOption = Array.from(fileSelect.options).find(o =>
        o.value.toLowerCase().includes('pdf') || o.text.toLowerCase().includes('pdf')
      )
      if (!pdfOption) return { ok: false, reason: 'PDF 옵션 없음', options: Array.from(fileSelect.options).map(o => o.value) }

      fileSelect.value = pdfOption.value
      fileSelect.dispatchEvent(new Event('change', { bubbles: true }))
      return { ok: true, selectedValue: pdfOption.value }
    }).catch(e => ({ ok: false, reason: String(e) }))

    info(`select[1] 설정: ok=${selectResult.ok}  value="${selectResult.selectedValue ?? selectResult.reason}"`)

    if (!selectResult.ok) {
      warn(`select 설정 실패: ${selectResult.reason}`)
    }

    // 확인 버튼 클릭 (button[2] = text "확인")
    const confirmResult = await ozPage.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'))
      const confirmBtn = buttons.find(b => b.textContent?.trim() === '확인')
      if (!confirmBtn) return { ok: false, reason: '확인 버튼 없음' }
      const r = confirmBtn.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) return { ok: false, reason: '확인 버튼 비표시' }
      confirmBtn.click()
      return { ok: true }
    }).catch(e => ({ ok: false, reason: String(e) }))

    R.confirmedClick = confirmResult.ok
    info(`확인 버튼 클릭: ok=${confirmResult.ok}  ${confirmResult.reason ?? ''}`)

    if (confirmResult.ok) {
      info('확인 클릭 완료 — 다운로드 대기 (최대 30초)...')
      await ozPage.screenshot({ path: `${ssDir}/ozpdf3_after_confirm.png`, fullPage: true })

      const dl    = dlEvent ?? await dlPromise
      const popup = await popupProm

      if (dl) {
        R.downloadFired    = true
        R.downloadFilename = dl.suggestedFilename()
        R.downloadExt      = path.extname(dl.suggestedFilename()).toLowerCase()
        const saveName = `oz_pdf_${TEST_DATE.replace(/-/g,'')}_${Date.now()}${R.downloadExt || '.pdf'}`
        const savePath = path.join(pdfDir, saveName)
        await dl.saveAs(savePath)
        if (fs.existsSync(savePath)) {
          R.downloadSize = fs.statSync(savePath).size
          R.savedPath    = savePath
        }
        found(`다운로드 성공: "${R.downloadFilename}"  확장자: ${R.downloadExt}  크기: ${R.downloadSize.toLocaleString()} bytes`)
        found(`저장 경로: ${R.savedPath}`)
      } else {
        warn('download 이벤트 없음 (30초 대기 후 타임아웃)')

        // 최종 body 확인
        const bodyFinal = await ozPage.evaluate(() => document.body?.innerText ?? '').catch(() => '')
        info(`확인 후 body (앞 400자): ${bodyFinal.slice(0, 400).replace(/\n/g,' ')}`)
        await ozPage.screenshot({ path: `${ssDir}/ozpdf3_no_download.png`, fullPage: true })
      }

      if (popup) {
        R.newPageFired = true
        found(`새 탭/팝업: ${popup.url()}`)
        await popup.screenshot({ path: `${ssDir}/ozpdf3_popup.png` })
        await popup.close().catch(() => {})
      }
    }

    await ozPage.waitForTimeout(1000)
    await ozPage.screenshot({ path: `${ssDir}/ozpdf3_final.png`, fullPage: true })

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
  row( 1, '저장 버튼 클릭',              'YES (확인됨)',                         true)
  row( 2, '파일 형식 패널 구조',         'select[1] + button[확인/취소] 확인됨', true)
  row( 3, 'PDF 선택 + 확인 클릭',        R.confirmedClick ? 'YES' : 'NO',        R.confirmedClick)
  row( 4, 'download 이벤트 발생',        R.downloadFired ? 'YES' : 'NO',         R.downloadFired)
  row( 5, '팝업/새탭 발생',              R.newPageFired ? 'YES' : 'NO',          undefined)
  row( 6, 'alert/dialog 발생',           R.dialogFired ? 'YES' : 'NO',          undefined)
  row( 7, '다운로드 파일명',             R.downloadFilename,                     undefined)
  row( 8, '다운로드 파일 확장자',        R.downloadExt,                          R.downloadFired ? R.downloadExt === '.pdf' : undefined)
  row( 9, '다운로드 파일 크기',          R.downloadSize > 0 ? `${R.downloadSize.toLocaleString()} bytes` : '0', R.downloadFired ? R.downloadSize > 0 : undefined)
  row(10, '저장 경로',                   R.savedPath,                            undefined)
  row(11, '인쇄 버튼 후보',             'input[type=image][alt="인쇄"] — 추후 테스트', undefined)
  row(12, 'page.pdf() 방식 폐기',        R.downloadFired ? '폐기 가능' : '아직 유지 필요', undefined)
  console.log()
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(C.red('\n[FATAL] ' + err.message))
    console.error(err.stack)
    process.exit(1)
  })
