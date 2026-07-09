/**
 * OZ Viewer 저장 버튼 클릭 테스트
 *
 * 실행: npx electron test_oz_save_button.js
 *
 * 목적:
 *   - OZ Viewer 로딩 완료 확인
 *   - 저장 버튼 클릭 시 download 이벤트 발생 여부
 *   - 인쇄 버튼 동작 후보 확인
 *   - page.pdf() 폐기 여부 판단
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
const TOEVER_BASE = 'https://support.toever.co.kr'
const OZ_URL_BASE = `${TOEVER_BASE}/VendorMgr/PoState/rptSalePaperPrintP_HTML.jsp`
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
const fail    = m => console.log(`  ${C.red('✗')}  ${C.red(m)}`)
const section = m => console.log(`\n${C.bold(C.cyan('▶ ' + m))}`)
const sep     = () => console.log(C.gray('  ─────────────────────────────────────────────────'))

const OZ_LOADING_TEXTS = [
  '오즈 리포트 뷰어를 실행하고 있습니다',
  '데이터 모듈을 받기 시작합니다',
  '데이터 모듈을 받고 있습니다',
]

// ── OZ Viewer 로딩 완료 대기 (공통) ──────────────────────────────────
async function waitOZLoad(page, maxMs = 40000) {
  const POLL = 2000
  let elapsed = 0
  while (elapsed < maxMs) {
    await page.waitForTimeout(POLL)
    elapsed += POLL
    const bodyText = await page.evaluate(() => document.body?.innerText ?? '').catch(() => '')
    const loading = OZ_LOADING_TEXTS.some(t => bodyText.includes(t))
    info(`  [${elapsed/1000}s] 로딩 중: ${loading}  body길이: ${bodyText.length}`)
    if (!loading) {
      await page.waitForTimeout(3000)  // 렌더링 여유
      return { done: true, bodyText: await page.evaluate(() => document.body?.innerText ?? '') }
    }
  }
  return { done: false, bodyText: '' }
}

async function main() {
  console.log(C.bold('\n══════════════════════════════════════════════'))
  console.log(C.bold('  OZ Viewer 저장 버튼 클릭 테스트'))
  console.log(C.bold(`  날짜: ${TEST_DATE}`))
  console.log(C.bold('══════════════════════════════════════════════\n'))

  const storage = require(path.join(DIST, 'electron/services/storage.js'))
  storage.setBasePath(BASE_PATH)
  storage.ensureAllDirs()
  const { initDb } = require(path.join(DIST, 'electron/services/db/schema.js'))
  initDb(BASE_PATH)
  const browser = require(path.join(DIST, 'electron/services/toever/browser.js'))
  const ssDir   = storage.DIRS.logsScreenshots()
  const pdfDir  = storage.DIRS.pdfContracts()
  if (!fs.existsSync(pdfDir)) fs.mkdirSync(pdfDir, { recursive: true })

  // 12가지 보고 항목
  const R = {
    saveBtnExists:    false,
    saveBtnVisible:   false,
    saveBtnClickable: false,
    downloadFired:    false,
    popupFired:       false,
    alertFired:       false,
    downloadFilename: '',
    downloadExt:      '',
    downloadSize:     0,
    savedPath:        '',
    printBtnCandidate: '',
    pagePdfDeprecated: true,
    ozLoaded:         false,
    ozNoData:         false,
    ozBodyPreview:    '',
  }

  let bSession = null
  try {
    // ── 1. 로그인 ─────────────────────────────────────────────────
    section('1. 투에버 로그인')
    bSession = await browser.launchBrowser(ssDir)
    const { page: mainPage, context } = bSession
    const loginResult = await browser.loginToever(mainPage, TOEVER_ID, TOEVER_PW)
    if (!loginResult.success) throw new Error(`로그인 실패: ${loginResult.error}`)
    info(`로그인 ${loginResult.sessionReused ? '(세션 재사용)' : '성공'}`)

    // ── 2. 발주내역 조회 → 발주번호 범위 추출 ────────────────────
    section('2. 발주내역 조회 + getReportCommonParams()')
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

    const commonParams = await frame.evaluate(() => {
      if (typeof window.getReportCommonParams === 'function') return window.getReportCommonParams()
      return null
    }).catch(() => null)

    if (!commonParams?.p_order_no) throw new Error('getReportCommonParams() 실패 또는 발주번호 없음')

    const pdf_order_no_from = String(commonParams.p_order_no)
    const pdf_order_no_to   = String(commonParams.p_order_noTo)
    found(`발주번호 범위: ${pdf_order_no_from} ~ ${pdf_order_no_to}`)

    if (!pdf_order_no_from.startsWith('019')) {
      warn(`발주번호 형식 아님: ${pdf_order_no_from} — 019xxx 형식이어야 함`)
    }

    // OZ URL 구성
    const qs = new URLSearchParams({
      p_xml_file: '/SALE/vendor_sale_paper_new.ozr',
      p_company_cd: commonParams.p_company_cd ?? '01',
      p_merchant_cd: commonParams.p_merchant_cd ?? '0001',
      p_entr_no: commonParams.p_entr_no ?? '',
      p_order_dt: dc, p_order_dtTo: dc,
      p_storeout_sts: commonParams.p_storeout_sts ?? '01',
      p_order_no: pdf_order_no_from,
      p_order_noTo: pdf_order_no_to,
    })
    const OZ_URL = `${OZ_URL_BASE}?${qs.toString()}`
    info(`OZ URL: ${OZ_URL}`)

    // ── 3. OZ Viewer 탭 열기 (같은 context — 쿠키 공유) ──────────
    section('3. OZ Viewer 탭 열기')
    const ozPage = await context.newPage()

    // download 이벤트 리스너 등록 (버튼 클릭 전에 미리)
    let downloadEvent = null
    ozPage.on('download', dl => { downloadEvent = dl })

    // alert/dialog 리스너
    let dialogInfo = null
    ozPage.on('dialog', async dlg => {
      dialogInfo = { type: dlg.type(), message: dlg.message() }
      info(`  dialog 감지: type=${dlg.type()} msg="${dlg.message()}"`)
      await dlg.dismiss().catch(() => {})
    })

    await ozPage.goto(OZ_URL, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await ozPage.screenshot({ path: `${ssDir}/oz_save_after_open.png`, fullPage: true })
    info('페이지 열림 — 로딩 대기 시작')

    // ── 4. OZ Viewer 로딩 완료 대기 ─────────────────────────────
    section('4. OZ Viewer 로딩 완료 대기')
    const loadResult = await waitOZLoad(ozPage)
    R.ozLoaded = loadResult.done
    R.ozBodyPreview = (loadResult.bodyText ?? '').slice(0, 500)

    await ozPage.screenshot({ path: `${ssDir}/oz_save_after_load.png`, fullPage: true })
    info(`로딩 완료: ${R.ozLoaded}`)
    info(`body 내용: ${R.ozBodyPreview.slice(0, 200).replace(/\n/g, ' ')}`)

    if (loadResult.bodyText?.includes('조회된 데이터가 없습니다')) {
      R.ozNoData = true
      warn('"조회된 데이터가 없습니다" — OZ Viewer에 데이터 없음')
    }

    // ── 5. 버튼 탐색 ─────────────────────────────────────────────
    section('5. 저장/인쇄 버튼 탐색')
    const btnInfo = await ozPage.evaluate(() => {
      const all = Array.from(document.querySelectorAll('input[type=image], button'))
      const isVisible = el => {
        const r = el.getBoundingClientRect()
        const s = window.getComputedStyle(el)
        return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden'
      }
      return all.map(el => ({
        tag:      el.tagName,
        type:     el.type ?? '',
        alt:      el.alt ?? '',
        title:    el.title ?? '',
        text:     (el.textContent ?? '').trim().slice(0, 40),
        id:       el.id ?? '',
        cls:      el.className ?? '',
        disabled: el.disabled,
        visible:  isVisible(el),
        onclick:  el.getAttribute('onclick')?.slice(0, 80) ?? '',
        src:      (el.src ?? '').slice(-30),
      }))
    }).catch(() => [])

    btnInfo.forEach((b, i) => {
      const label = [b.alt, b.title, b.text].filter(Boolean).join(' / ')
      info(`[${i}] <${b.tag} type=${b.type}> "${label}" cls="${b.cls.slice(0,30)}" visible=${b.visible} disabled=${b.disabled}`)
    })

    const saveBtn  = btnInfo.find(b => b.alt === '저장' || b.title === '저장')
    const printBtn = btnInfo.find(b => b.alt === '인쇄' || b.title === '인쇄')
    const dataSaveBtn = btnInfo.find(b => b.alt?.includes('데이터 저장') || b.title?.includes('데이터 저장'))

    R.saveBtnExists  = !!saveBtn
    R.saveBtnVisible = saveBtn?.visible ?? false

    sep()
    if (saveBtn)     found(`저장 버튼: alt="${saveBtn.alt}" visible=${saveBtn.visible} disabled=${saveBtn.disabled}`)
    else             fail('저장 버튼(alt=저장) 없음')
    if (printBtn)    found(`인쇄 버튼: alt="${printBtn.alt}" visible=${printBtn.visible}`)
    else             warn('인쇄 버튼(alt=인쇄) 없음')
    if (dataSaveBtn) found(`데이터 저장 버튼: alt="${dataSaveBtn.alt}"`)

    // ── 6. getOZMovie() 메서드 탐색 ─────────────────────────────
    section('6. window.getOZMovie() 메서드 탐색')
    const ozMethods = await ozPage.evaluate(() => {
      if (typeof window.getOZMovie !== 'function') return { exists: false }
      try {
        const oz = window.getOZMovie()
        if (!oz) return { exists: true, instance: false }
        const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(oz))
          .filter(n => typeof oz[n] === 'function')
        const allKeys = Object.keys(oz).filter(k => typeof oz[k] === 'function')
        return { exists: true, instance: true, protoMethods: methods, ownMethods: allKeys }
      } catch (e) {
        return { exists: true, error: String(e) }
      }
    }).catch(() => ({ exists: false }))

    if (!ozMethods.exists) {
      warn('window.getOZMovie() 없음')
    } else if (ozMethods.error) {
      warn(`getOZMovie() 호출 오류: ${ozMethods.error}`)
    } else if (!ozMethods.instance) {
      warn('getOZMovie() 반환값 null/undefined')
    } else {
      found(`OZ 객체 메서드 (proto): ${JSON.stringify(ozMethods.protoMethods?.slice(0, 20))}`)
      found(`OZ 객체 메서드 (own) : ${JSON.stringify(ozMethods.ownMethods?.slice(0, 20))}`)
      const saveMethods = [...(ozMethods.protoMethods ?? []), ...(ozMethods.ownMethods ?? [])]
        .filter(m => /save|print|export|pdf|download/i.test(m))
      if (saveMethods.length > 0) found(`저장/인쇄 관련 메서드: ${JSON.stringify(saveMethods)}`)
    }

    // ── 7. 저장 버튼 클릭 테스트 ─────────────────────────────────
    section('7. 저장 버튼 클릭 테스트')

    if (!saveBtn || !saveBtn.visible) {
      warn('저장 버튼 없거나 비표시 — 클릭 스킵')
      R.saveBtnClickable = false
    } else {
      R.saveBtnClickable = true
      info('저장 버튼 클릭...')

      // 팝업 감지
      let popupPage = null
      const popupPromise = context.waitForEvent('page', { timeout: 5000 }).catch(() => null)

      // download 감지 (5초 대기)
      const downloadPromise = ozPage.waitForEvent('download', { timeout: 8000 }).catch(() => null)

      // 버튼 클릭
      try {
        await ozPage.click('input[type=image][alt="저장"]', { timeout: 5000 })
        info('클릭 완료 — 이벤트 대기 중...')
      } catch (e) {
        warn(`클릭 오류: ${e.message}`)
      }

      // download 이벤트 확인
      const dl = downloadEvent ?? await downloadPromise
      popupPage = await popupPromise

      await ozPage.waitForTimeout(3000)
      await ozPage.screenshot({ path: `${ssDir}/oz_save_after_click.png`, fullPage: true })

      if (dl) {
        R.downloadFired    = true
        R.downloadFilename = dl.suggestedFilename()
        R.downloadExt      = path.extname(dl.suggestedFilename()).toLowerCase()
        const savePath = path.join(pdfDir, `oz_save_${Date.now()}${R.downloadExt || '.bin'}`)
        await dl.saveAs(savePath).catch(e => info(`saveAs 오류: ${e.message}`))
        if (fs.existsSync(savePath)) {
          R.downloadSize = fs.statSync(savePath).size
          R.savedPath    = savePath
        }
        found(`download 이벤트 발생: "${R.downloadFilename}" (${R.downloadSize} bytes)`)
        found(`저장 경로: ${R.savedPath}`)
      } else {
        R.downloadFired = false
        warn('download 이벤트 없음')
      }

      if (popupPage) {
        R.popupFired = true
        found(`팝업/새 탭 감지: ${popupPage.url()}`)
        await popupPage.screenshot({ path: `${ssDir}/oz_save_popup.png`, fullPage: true })
        await popupPage.close().catch(() => {})
      } else {
        info('팝업 없음')
      }

      if (dialogInfo) {
        R.alertFired = true
        found(`alert/confirm 감지: type="${dialogInfo.type}" msg="${dialogInfo.message}"`)
      } else {
        info('alert/confirm 없음')
      }

      // 클릭 후 body 변화 확인
      const bodyAfter = await ozPage.evaluate(() => document.body?.innerText ?? '').catch(() => '')
      info(`클릭 후 body (앞 200자): ${bodyAfter.slice(0, 200).replace(/\n/g, ' ')}`)
    }

    // ── 8. 인쇄 버튼 후보 분석 (클릭 안 함) ─────────────────────
    section('8. 인쇄 버튼 후보 분석 (비클릭)')
    if (printBtn) {
      R.printBtnCandidate = `input[type=image][alt="인쇄"]  visible=${printBtn.visible}`
      info(`인쇄 버튼 selector: input[type=image][alt="인쇄"]`)
      info(`인쇄 버튼 visible: ${printBtn.visible}`)
      info('⚠ 인쇄 버튼 클릭 시 OS 인쇄 대화창이 열릴 수 있으므로 이번 단계에서는 클릭 안 함')
    } else {
      warn('인쇄 버튼 없음')
    }

  } catch (err) {
    warn(`오류: ${err.message}`)
    console.error(err.stack)
  } finally {
    if (bSession) { info('브라우저 종료...'); await browser.closeBrowser() }
  }

  // ── 9. 보고 12항목 ────────────────────────────────────────────
  section('9. 보고 12항목')
  const row = (no, label, value, ok) => {
    const mark = ok === undefined ? '  ' : ok ? C.green(' ✓') : C.red(' ✗')
    const v    = value === '' || value === null || value === undefined ? C.gray('(없음)') : C.cyan(String(value))
    console.log(`${mark}  ${C.bold(String(no).padStart(2) + '.')} ${label.padEnd(36)} ${v}`)
  }
  console.log()
  row( 1, '저장 버튼 selector 존재',          R.saveBtnExists ? 'input[type=image][alt="저장"]' : 'NO', R.saveBtnExists)
  row( 2, '저장 버튼 visible',                R.saveBtnVisible ? 'YES' : 'NO', R.saveBtnVisible)
  row( 3, '저장 버튼 클릭 시도',              R.saveBtnClickable ? 'YES' : 'NO', R.saveBtnClickable)
  row( 4, 'download 이벤트 발생',             R.downloadFired ? 'YES' : 'NO', R.downloadFired === true ? true : (R.saveBtnClickable ? false : undefined))
  row( 5, '팝업/새창 발생',                   R.popupFired ? 'YES' : 'NO', undefined)
  row( 6, 'alert/confirm 발생',               R.alertFired ? 'YES' : 'NO', undefined)
  row( 7, '다운로드 파일명',                  R.downloadFilename, undefined)
  row( 8, '다운로드 파일 확장자',             R.downloadExt, undefined)
  row( 9, '다운로드 파일 크기',               R.downloadSize > 0 ? `${R.downloadSize.toLocaleString()} bytes` : '0', R.downloadFired ? R.downloadSize > 0 : undefined)
  row(10, '저장 경로',                        R.savedPath, undefined)
  row(11, '인쇄 버튼 후보',                   R.printBtnCandidate || '(없음)', undefined)
  row(12, 'page.pdf() 방식 폐기 여부',        R.downloadFired ? '폐기 (저장버튼 다운로드 방식 사용)' : 'OZ 저장버튼 실패 시 유지', undefined)
  row(13, 'OZ Viewer 로딩 완료',              R.ozLoaded ? 'YES' : 'NO', R.ozLoaded)
  row(14, 'OZ 데이터 없음 감지',              R.ozNoData ? 'YES (조회된 데이터가 없습니다)' : 'NO', R.ozNoData ? false : undefined)
  row(15, 'OZ body 내용 (앞 200자)',          R.ozBodyPreview.slice(0, 200).replace(/\n/g, ' '), undefined)
  console.log()
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(C.red('\n[FATAL] ' + err.message))
    console.error(err.stack)
    process.exit(1)
  })
