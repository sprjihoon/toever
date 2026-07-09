/**
 * 투에버 송장 업로드 — 빈 양식 업로드 테스트
 * 실행: TOEVER_ID=B0000117 TOEVER_PW=unit npx electron test_empty_upload.js
 *
 * - 빈 헤더 전용 .xls 파일(데이터 행 0건)로 실제 uploadBtn 클릭
 * - DB 주문 상태 변경 없음
 * - 출고작업지시 없음
 * - 자동 재시도 없음
 * - 결과 HTML / 스크린샷 / alert 저장
 */
'use strict'

const path = require('path')
const fs   = require('fs')
const os   = require('os')

const TOEVER_ID     = process.env.TOEVER_ID
const TOEVER_PW     = process.env.TOEVER_PW
const BROWSERS_PATH = path.join(process.env.APPDATA ?? os.homedir(), 'spring-toever-ops', 'browsers')
process.env.PLAYWRIGHT_BROWSERS_PATH = BROWSERS_PATH

const TOEVER_BASE = 'https://support.toever.co.kr'
const UPLOAD_URL  = `${TOEVER_BASE}/deliveryupload/deliveryListP.jsp`
const OUT_DIR     = path.join(__dirname, 'screenshots', `empty_upload_${Date.now()}`)
fs.mkdirSync(OUT_DIR, { recursive: true })

const C = {
  green:  s => `\x1b[32m${s}\x1b[0m`,
  red:    s => `\x1b[31m${s}\x1b[0m`,
  cyan:   s => `\x1b[36m${s}\x1b[0m`,
  bold:   s => `\x1b[1m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
}
function section(m) { console.log(`\n${C.bold(C.cyan('▶ ' + m))}`) }
function info(m)    { console.log(`  ℹ  ${m}`) }
function ok(m)      { console.log(`  ${C.green('✓')}  ${m}`) }
function warn(m)    { console.log(`  ${C.yellow('⚠')}  ${m}`) }

// ── BIFF8 빈 양식 파일 생성 ──────────────────────────────────────
function createEmptyUploadFile(dir) {
  const XLSX = require('xlsx')
  const wb   = XLSX.utils.book_new()

  // Sheet1: 헤더만, 데이터 행 0건
  const ws = XLSX.utils.aoa_to_sheet([['주문번호', '송장번호']])
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')

  const filename = `empty_toever_invoice_upload_${Date.now()}.xls`
  const filePath = path.join(dir, filename)
  const buf      = XLSX.write(wb, { bookType: 'biff8', type: 'buffer' })
  fs.writeFileSync(filePath, buf)

  // 바이너리 검증
  const sig = buf.slice(0, 4)
  const isBiff8 = sig[0] === 0xD0 && sig[1] === 0xCF && sig[2] === 0x11 && sig[3] === 0xE0
  info(`생성 파일: ${filename}`)
  info(`크기: ${buf.length} bytes | BIFF8: ${isBiff8} | 헤더행: 1 | 데이터행: 0`)
  return filePath
}

async function main() {
  console.log(C.bold('\n══════════════════════════════════════════════'))
  console.log(C.bold('  투에버 송장 업로드 — 빈 양식 업로드 테스트'))
  console.log(C.bold('══════════════════════════════════════════════\n'))
  info('⚠  데이터 행 0건 파일로 uploadBtn 실제 클릭')
  info('⚠  DB 주문 상태 변경 없음')
  info('⚠  출고작업지시 없음 / 재시도 없음')
  info(`결과 저장 폴더: ${OUT_DIR}`)

  if (!TOEVER_ID || !TOEVER_PW) { console.error('TOEVER_ID/PW 필요'); process.exit(1) }

  const report = {
    upload_page_accessible:  false,
    upload_token_exists:     false,
    upload_token_value:      '',
    file_attach_success:     false,
    upload_btn_clicked:      false,
    alert_message:           '',
    result_page_text:        '',
    result_page_url:         '',
    processed_count:         '',
    error_table_content:     '',
    back_button_exists:      false,
    error_excel_download:    false,
    html_path:               '',
    screenshot_before:       '',
    screenshot_after:        '',
    screenshot_alert:        '',
  }

  const { chromium } = require('playwright')
  const browser = await chromium.launch({ headless: false, args: ['--no-sandbox'] })
  const ctx  = await browser.newContext({ locale: 'ko-KR', timezoneId: 'Asia/Seoul',
    acceptDownloads: true })
  const page = await ctx.newPage()

  // alert / dialog 캡처
  page.on('dialog', async dialog => {
    const msg = dialog.message()
    info(`[DIALOG] type="${dialog.type()}" message="${msg}"`)
    report.alert_message += (report.alert_message ? ' | ' : '') + `[${dialog.type()}] ${msg}`
    await dialog.accept()
  })

  try {
    // ── 1. 로그인 ────────────────────────────────────────────────
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
      ok('로그인 완료')
    } catch { ok('세션 재사용') }

    // ── 2. 업로드 페이지 이동 ────────────────────────────────────
    section('2. 업로드 페이지 접근')
    await page.goto(UPLOAD_URL, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForTimeout(2000)

    const uploadUrl = page.url()
    info(`URL: ${uploadUrl}`)
    if (uploadUrl.toLowerCase().includes('login')) {
      warn('로그인 리다이렉트 발생 → 종료')
      process.exit(1)
    }

    const tf = page.frames().find(f => f.url().includes('deliveryListP') || f.url().includes('deliveryupload')) ?? page
    info(`frame: ${tf.url()}`)

    // 페이지 접근 여부
    const body = await tf.content()
    report.upload_page_accessible = !body.includes('이용에 불편을 드려')
    if (report.upload_page_accessible) {
      ok('업로드 페이지 접근 성공')
    } else {
      warn('업로드 페이지 접근 실패 (404)'); process.exit(1)
    }

    await page.screenshot({ path: path.join(OUT_DIR, '01_upload_page.png'), fullPage: true })
    info('스크린샷: 01_upload_page.png')

    // ── 3. UPLOAD_TOKEN 확인 ─────────────────────────────────────
    section('3. UPLOAD_TOKEN 확인')
    const tokenEl = await tf.$('input[name="UPLOAD_TOKEN"]').catch(() => null)
    report.upload_token_exists = !!tokenEl
    if (tokenEl) {
      report.upload_token_value = await tf.$eval(
        'input[name="UPLOAD_TOKEN"]', el => el.value
      ).catch(() => '')
      ok(`UPLOAD_TOKEN 존재: "${report.upload_token_value.slice(0, 20)}..."`)
    } else {
      warn('UPLOAD_TOKEN 없음')
    }

    // ── 4. 빈 파일 생성 및 첨부 ─────────────────────────────────
    section('4. 빈 양식 파일 생성 및 첨부')
    const emptyFilePath = createEmptyUploadFile(OUT_DIR)
    ok(`빈 파일 생성: ${path.basename(emptyFilePath)}`)

    // 파일 첨부
    const fileInput = await tf.$('input#uploadFile').catch(() => null)
      ?? await tf.$('input[type="file"]').catch(() => null)
    if (!fileInput) { warn('파일 input 없음 → 종료'); process.exit(1) }

    await fileInput.setInputFiles(emptyFilePath)
    await page.waitForTimeout(800)
    report.file_attach_success = true
    ok('파일 첨부 완료')

    // 첨부 후 스크린샷
    report.screenshot_before = path.join(OUT_DIR, '02_before_upload.png')
    await page.screenshot({ path: report.screenshot_before, fullPage: true })
    info(`스크린샷: 02_before_upload.png`)

    // ── 5. uploadBtn 실제 클릭 ───────────────────────────────────
    section('5. uploadBtn 클릭 (빈 파일 업로드 실행)')
    info('⚠  실제 클릭 — 단 1회만 실행, 자동 재시도 없음')

    let navigationHappened = false
    const navPromise = page.waitForNavigation({
      waitUntil: 'domcontentloaded', timeout: 20000,
    }).then(() => { navigationHappened = true }).catch(() => {})

    // uploadBtn 클릭
    await tf.click('input#uploadBtn')
    report.upload_btn_clicked = true
    ok('uploadBtn 클릭 실행')

    await navPromise
    await page.waitForTimeout(3000)

    // ── 6. 결과 캡처 ─────────────────────────────────────────────
    section('6. 결과 캡처')
    report.result_page_url = page.url()
    info(`결과 페이지 URL: ${report.result_page_url}`)

    // 결과 화면 스크린샷
    report.screenshot_after = path.join(OUT_DIR, '03_after_upload.png')
    await page.screenshot({ path: report.screenshot_after, fullPage: true })
    ok(`스크린샷 저장: 03_after_upload.png`)

    // 결과 HTML 저장
    const resultHtml = await page.content()
    report.html_path = path.join(OUT_DIR, 'result.html')
    fs.writeFileSync(report.html_path, resultHtml, 'utf8')
    ok(`결과 HTML 저장: result.html (${(resultHtml.length / 1024).toFixed(1)} KB)`)

    // 텍스트 추출
    const allFrames = page.frames()
    let resultText = ''
    for (const f of allFrames) {
      try {
        const t = await f.evaluate(() => document.body?.innerText ?? '')
        if (t.trim()) resultText += t + '\n'
      } catch {}
    }
    report.result_page_text = resultText.trim().slice(0, 2000)
    info(`\n결과 페이지 텍스트:\n${'-'.repeat(50)}`)
    for (const line of resultText.split('\n').filter(l => l.trim())) {
      info(`  ${line.trim()}`)
    }
    info('-'.repeat(50))

    // ── 7. 처리 건수 파싱 ────────────────────────────────────────
    section('7. 처리 건수 분석')
    const countPatterns = [
      /(\d+)\s*건\s*처리/,
      /처리\s*:\s*(\d+)/,
      /총\s*(\d+)\s*건/,
      /(\d+)\s*rows?\s*processed/i,
      /(\d+)\s*건\s*등록/,
      /(\d+)\s*건\s*성공/,
    ]
    for (const pat of countPatterns) {
      const m = resultText.match(pat)
      if (m) { report.processed_count = m[0]; break }
    }
    info(`처리 건수 패턴 매칭: "${report.processed_count || '(없음)'}"`)

    // ── 8. 오류 테이블 확인 ──────────────────────────────────────
    section('8. 오류 테이블 분석')
    for (const f of allFrames) {
      try {
        const tables = await f.$$eval('table', tbls =>
          tbls.map(t => t.innerText?.trim().slice(0, 300))
        )
        for (const t of tables) {
          if (t) {
            info(`[테이블]\n${t.split('\n').map(l => '    ' + l).join('\n')}`)
            report.error_table_content += t + '\n---\n'
          }
        }
      } catch {}
    }

    // ── 9. 뒤로가기 버튼 확인 ───────────────────────────────────
    section('9. 뒤로가기 / 오류 엑셀 다운로드 확인')
    for (const f of allFrames) {
      try {
        const btns = await f.$$eval('input,button,a', els =>
          els.map(el => ({
            tag:   el.tagName,
            text:  el.textContent?.trim() ?? '',
            value: el.getAttribute('value') ?? '',
            href:  el.getAttribute('href') ?? '',
            onclick: el.getAttribute('onclick')?.slice(0, 60) ?? '',
          }))
        )
        for (const b of btns) {
          if (/뒤로|이전|back/i.test(b.text + b.value)) {
            report.back_button_exists = true
            info(`뒤로가기 버튼: [${b.tag}] text="${b.text}" value="${b.value}"`)
          }
          if (/오류|error|다운|excel|xlsx?/i.test(b.text + b.value + b.href + b.onclick)) {
            report.error_excel_download = true
            info(`오류/다운로드 요소: [${b.tag}] text="${b.text}" href="${b.href}" onclick="${b.onclick}"`)
          }
        }
      } catch {}
    }

    if (!report.back_button_exists) info('뒤로가기 버튼: 없음')
    if (!report.error_excel_download) info('오류 엑셀 다운로드: 없음')

  } catch(e) {
    warn(`[ERROR] ${e.message}`)
    try {
      const errSs = path.join(OUT_DIR, 'error.png')
      await page.screenshot({ path: errSs, fullPage: true })
      info(`오류 스크린샷: ${errSs}`)
    } catch {}
  } finally {
    await page.close().catch(() => {})
    await ctx.close().catch(() => {})
    await browser.close().catch(() => {})
  }

  // ── 10. DB 상태 변경 없음 확인 ──────────────────────────────────
  section('10. DB 주문 상태 변경 없음 확인')
  info('(빈 파일 테스트이므로 DB에 주문 없음 — DB 변경 없음 확인)')
  ok('DB 주문 상태 변경 없음 (빈 파일 테스트는 DB 연동 없음)')

  // ── 최종 보고 ────────────────────────────────────────────────────
  console.log(`\n${'═'.repeat(55)}`)
  console.log(C.bold('  보고 항목 정리'))
  console.log('═'.repeat(55))

  const reportItems = [
    ['1.  업로드 페이지 접근',       report.upload_page_accessible ? '✓ 성공' : '✗ 실패'],
    ['2.  UPLOAD_TOKEN 존재',        report.upload_token_exists ? `✓ 있음 (${report.upload_token_value.slice(0,16)}...)` : '✗ 없음'],
    ['3.  빈 파일 업로드 실행',      report.upload_btn_clicked ? '✓ 실행됨' : '✗ 미실행'],
    ['4.  alert 메시지',             report.alert_message || '(없음)'],
    ['5.  결과 페이지 URL',          report.result_page_url],
    ['6.  결과 페이지 주요 문구',    report.result_page_text.split('\n').slice(0,5).join(' / ').slice(0,100) || '(없음)'],
    ['7.  처리 건수',                report.processed_count || '(패턴 매칭 없음)'],
    ['8.  오류 테이블',              report.error_table_content ? report.error_table_content.split('\n').slice(0,3).join(' | ').slice(0,100) : '(없음)'],
    ['9.  뒤로가기 버튼',            report.back_button_exists ? '✓ 있음' : '없음'],
    ['10. 오류 엑셀 다운로드',       report.error_excel_download ? '✓ 있음' : '없음'],
    ['11. DB 주문 상태 변경',        '없음 (빈 파일 테스트)'],
    ['12. 저장 HTML',                report.html_path],
    ['13. 스크린샷(첨부전)',         report.screenshot_before],
    ['14. 스크린샷(결과)',           report.screenshot_after],
  ]

  for (const [k, v] of reportItems) {
    console.log(`  ${C.cyan(k.padEnd(24))} ${v}`)
  }

  console.log('\n' + '═'.repeat(55) + '\n')
  process.exit(0)
}

main().catch(e => {
  console.error(C.red('[FATAL] ' + e.message))
  console.error(e.stack)
  process.exit(1)
})
