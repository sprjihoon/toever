/**
 * 투에버 송장 업로드 파일 형식 검증
 * 실행: npx electron test_invoice_file_format.js
 *
 * 확인 항목:
 *  1. 생성 파일 확장자 .xls 확인
 *  2. BIFF8 바이너리 서명 확인 (xlsx로 이름만 바꾼 것이 아님)
 *  3. Sheet1 헤더: 주문번호 / 송장번호 (정확히 이 순서)
 *  4. 주문번호·송장번호 셀 타입 's' (string) 확인
 *  5. 앞자리 0 보존 확인 (재읽기)
 *  6. Toever upload_form.xls 샘플 다운로드 후 구조 비교
 *  7. .xlsx 시그니처(PK 헤더) 없음 확인
 *
 * 금지: 업로드 실행 / uploadBtn 클릭 / 출고작업지시
 */
'use strict'

const path = require('path')
const fs   = require('fs')
const os   = require('os')

const DIST          = path.join(__dirname, 'dist-electron')
const STORAGE       = path.join(os.tmpdir(), 'toever_fmt_' + Date.now())
const BROWSERS_PATH = path.join(process.env.APPDATA ?? os.homedir(), 'spring-toever-ops', 'browsers')
process.env.PLAYWRIGHT_BROWSERS_PATH = BROWSERS_PATH

const TOEVER_ID   = process.env.TOEVER_ID
const TOEVER_PW   = process.env.TOEVER_PW
const TOEVER_BASE = 'https://support.toever.co.kr'

const C = {
  green:  s => `\x1b[32m${s}\x1b[0m`,
  red:    s => `\x1b[31m${s}\x1b[0m`,
  cyan:   s => `\x1b[36m${s}\x1b[0m`,
  bold:   s => `\x1b[1m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
}
const OK = C.green('✓'), FAIL = C.red('✗')
let passed = 0, failed = 0, skipped = 0
const failList = []
function pass(msg) { console.log(`  ${OK}  ${msg}`); passed++ }
function fail(msg, e) {
  console.log(`  ${FAIL}  ${C.red(msg)}`)
  if (e) console.log(`     ${C.yellow(String(e).slice(0, 200))}`)
  failed++; failList.push(msg)
}
function skip(msg) { console.log(`  -   ${C.yellow('[SKIP] ' + msg)}`); skipped++ }
function section(msg) { console.log(`\n${C.bold(C.cyan('▶ ' + msg))}`) }
function info(msg)    { console.log(`  ℹ  ${msg}`) }

// ── XLSX 시그니처 감지 헬퍼 ──────────────────────────────────────
function detectFileType(filePath) {
  const buf = fs.readFileSync(filePath)
  const magic4 = buf.slice(0, 4)

  // BIFF8 (xls): D0 CF 11 E0
  const isBiff8 = magic4[0] === 0xD0 && magic4[1] === 0xCF &&
                  magic4[2] === 0x11 && magic4[3] === 0xE0

  // ZIP/XLSX: 50 4B 03 04 (PK header)
  const isZip   = magic4[0] === 0x50 && magic4[1] === 0x4B &&
                  magic4[2] === 0x03 && magic4[3] === 0x04

  // BIFF5/XLS (older): check same OLE signature
  return {
    isBiff8,
    isZip,
    hex: Array.from(magic4).map(b => b.toString(16).padStart(2,'0').toUpperCase()).join(' '),
  }
}

async function main() {
  console.log(C.bold('\n══════════════════════════════════════════════'))
  console.log(C.bold('  투에버 송장 업로드 파일 형식 검증'))
  console.log(C.bold('══════════════════════════════════════════════\n'))
  info('⚠  파일 생성과 검증만 수행 — 업로드 실행 없음')

  // ── 환경 초기화 ─────────────────────────────────────────────────
  section('0. 환경 초기화')
  const storage = require(path.join(DIST, 'electron/services/storage.js'))
  storage.setBasePath(STORAGE)
  storage.ensureAllDirs()
  pass('스토리지 초기화')

  const { initDb, getDb } = require(path.join(DIST, 'electron/services/db/schema.js'))
  initDb(STORAGE)
  const db = getDb()
  pass('DB 초기화')

  // ── 시드 데이터 ─────────────────────────────────────────────────
  section('1. 테스트 데이터 준비')

  // 앞자리 0이 있는 주문번호 / 송장번호 포함
  const testOrders = [
    { order_no: '0190012026070800001', invoice_no: '0012345678901' },  // 앞자리 0
    { order_no: '0190012026070800002', invoice_no: '0099887766554' },  // 앞자리 0
    { order_no: '0190012026070800003', invoice_no: '1234567890123' },  // 일반
  ]

  for (const o of testOrders) {
    db.prepare(`
      INSERT OR IGNORE INTO order_header (
        toever_order_no, toever_po_no, order_date, receiver_name, receiver_phone,
        receiver_address, status, latest_invoice_no, hash_snapshot
      ) VALUES (?, ?, '2026-07-08', '테스트수취인', '010-0000-0000',
                '서울시', 'INVOICE_IMPORTED', ?, ?)
    `).run(o.order_no, `PO-${o.order_no}`, o.invoice_no, `hash-${o.order_no}`)
  }

  pass(`시드 데이터 삽입: ${testOrders.length}건 (앞자리 0 포함)`)

  // ── 파일 생성 ───────────────────────────────────────────────────
  section('2. 파일 생성')
  const { buildToeverInvoiceUploadFile } = require(path.join(DIST, 'electron/services/exporter/toeverInvoiceBuilder.js'))
  const { getOrdersForToeverInvoiceUpload } = require(path.join(DIST, 'electron/services/db/repositories.js'))

  const orders = getOrdersForToeverInvoiceUpload()
  info(`업로드 대상 주문: ${orders.length}건`)

  let filePath = null
  try {
    const result = buildToeverInvoiceUploadFile(orders)
    filePath = result.filePath
    pass(`파일 생성: ${path.basename(filePath)} (${result.rowCount}행)`)
  } catch(e) {
    fail('파일 생성 실패', e)
    process.exit(1)
  }

  // ── 1. 확장자 .xls 확인 ─────────────────────────────────────────
  section('3. 파일 확장자 확인')
  const ext = path.extname(filePath).toLowerCase()
  info(`확장자: "${ext}"`)
  if (ext === '.xls') {
    pass('확장자: .xls ✓')
  } else {
    fail(`확장자 오류: "${ext}" (기대값: .xls)`)
  }

  // ── 2. BIFF8 바이너리 시그니처 확인 ────────────────────────────
  section('4. 바이너리 시그니처 확인 (BIFF8 vs XLSX)')
  const sig = detectFileType(filePath)
  info(`파일 헤더 (첫 4바이트): ${sig.hex}`)
  info(`BIFF8 시그니처(D0 CF 11 E0): ${sig.isBiff8 ? '✓' : '✗'}`)
  info(`ZIP/XLSX 시그니처(PK 50 4B 03 04): ${sig.isZip ? '⚠ 감지됨!' : '없음 ✓'}`)

  if (sig.isBiff8) {
    pass('BIFF8 바이너리 형식 확인 (진짜 xls, 이름만 바꾼 xlsx 아님)')
  } else if (sig.isZip) {
    fail('ZIP/XLSX 시그니처 감지 — .xlsx를 .xls로 이름만 바꾼 파일', sig.hex)
  } else {
    fail(`알 수 없는 바이너리 시그니처: ${sig.hex}`)
  }

  // ── 3-5. 헤더, 타입, 앞자리 0 보존 (재읽기) ────────────────────
  section('5. 파일 재읽기 — 헤더 / 타입 / 앞자리 0 보존')
  const XLSX = require('xlsx')
  const wbRead = XLSX.readFile(filePath, { cellText: false, raw: false })

  // Sheet1 존재 확인
  if (!wbRead.SheetNames.includes('Sheet1')) {
    fail('Sheet1 없음', `시트: ${wbRead.SheetNames.join(', ')}`)
  } else {
    pass(`Sheet1 존재 (시트 목록: ${wbRead.SheetNames.join(', ')})`)
  }

  const ws = wbRead.Sheets['Sheet1']

  // 헤더 확인
  const A1 = ws['A1']?.v
  const B1 = ws['B1']?.v
  info(`A1 헤더: "${A1}"`)
  info(`B1 헤더: "${B1}"`)

  if (A1 === '주문번호' && B1 === '송장번호') {
    pass('Sheet1 헤더: 주문번호 / 송장번호 (순서 정확)')
  } else {
    fail(`헤더 오류: A1="${A1}" B1="${B1}" (기대: 주문번호/송장번호)`)
  }

  // 셀 타입 확인 (row 2 = 첫 번째 데이터 행)
  const A2 = ws['A2']
  const B2 = ws['B2']
  info(`A2 셀: type="${A2?.t}" value="${A2?.v}" format="${A2?.z ?? ''}"`)
  info(`B2 셀: type="${B2?.t}" value="${B2?.v}" format="${B2?.z ?? ''}"`)

  if (A2?.t === 's') {
    pass(`주문번호(A2) 셀 타입 's' (string) 확인`)
  } else {
    fail(`주문번호(A2) 셀 타입 오류: "${A2?.t}" (기대: 's')`)
  }
  if (B2?.t === 's') {
    pass(`송장번호(B2) 셀 타입 's' (string) 확인`)
  } else {
    fail(`송장번호(B2) 셀 타입 오류: "${B2?.t}" (기대: 's')`)
  }

  // 앞자리 0 보존 확인 — json_to_sheet 재읽기
  const rows = XLSX.utils.sheet_to_json(ws, { raw: false, defval: '' })
  info(`\n  재읽기 결과 (${rows.length}행):`)
  info(`  ${'주문번호'.padEnd(25)} 송장번호`)
  info(`  ${'─'.repeat(50)}`)
  for (const row of rows) {
    const orderNo   = row['주문번호']  ?? row['order_no']  ?? ''
    const invoiceNo = row['송장번호'] ?? row['invoice_no'] ?? ''
    info(`  ${String(orderNo).padEnd(25)} ${invoiceNo}`)
  }

  let zeroPreserved = true
  for (const orig of testOrders) {
    const found = rows.find(r =>
      (r['주문번호'] ?? '') === orig.order_no ||
      (r['order_no'] ?? '') === orig.order_no
    )
    if (!found) {
      fail(`주문번호 "${orig.order_no}" 재읽기에서 누락`)
      zeroPreserved = false
      continue
    }
    const readOrderNo   = found['주문번호'] ?? found['order_no'] ?? ''
    const readInvoiceNo = found['송장번호'] ?? found['invoice_no'] ?? ''

    if (String(readOrderNo) === orig.order_no) {
      // OK
    } else {
      fail(`앞자리 0 소실: 원본="${orig.order_no}" 재읽기="${readOrderNo}"`)
      zeroPreserved = false
    }
    if (String(readInvoiceNo) === orig.invoice_no) {
      // OK
    } else {
      fail(`송장번호 앞자리 0 소실: 원본="${orig.invoice_no}" 재읽기="${readInvoiceNo}"`)
      zeroPreserved = false
    }
  }
  if (zeroPreserved) {
    pass('앞자리 0 보존 확인 (모든 주문번호·송장번호)')
  }

  // ── 6. upload_form.xls 샘플 구조 비교 ──────────────────────────
  section('6. upload_form.xls 샘플 구조 비교')
  if (!TOEVER_ID || !TOEVER_PW) {
    skip('TOEVER_ID/PW 없음 — 샘플 파일 다운로드 건너뜀')
    info('(샘플 없이도 헤더·타입·시그니처 검증은 완료)')
  } else {
    const { chromium } = require('playwright')
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
    const ctx  = await browser.newContext({ locale: 'ko-KR', timezoneId: 'Asia/Seoul' })
    const page = await ctx.newPage()

    const UPLOAD_URL = `${TOEVER_BASE}/deliveryupload/deliveryListP.jsp`
    let samplePath = null

    try {
      // 로그인
      await page.goto(TOEVER_BASE, { waitUntil: 'domcontentloaded', timeout: 30000 })
      await page.waitForTimeout(1000)
      const mf = page.frame({ name: 'mainFrm' }) ?? page
      await mf.waitForSelector('input[name="p_login_id"]', { timeout: 5000 }).catch(() => {})
      if (await mf.$('input[name="p_login_id"]')) {
        await mf.fill('input[name="p_login_id"]', TOEVER_ID)
        await mf.fill('input[name="p_password"]',  TOEVER_PW)
        await Promise.all([
          mf.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {}),
          mf.click('input[type="image"][alt="로그인"]'),
        ])
        await page.waitForTimeout(1500)
      }

      // 업로드 페이지 이동
      await page.goto(UPLOAD_URL, { waitUntil: 'domcontentloaded', timeout: 30000 })
      await page.waitForTimeout(1500)

      // downFile 함수로 파일 ID 추출
      const tf = page.frames().find(f => f.url().includes('deliveryListP')) ?? page
      const downFileFn = await tf.evaluate(() => {
        const link = document.querySelector('a[onclick*="downFile"]')
        return link?.getAttribute('onclick') ?? ''
      }).catch(() => '')
      info(`샘플 다운로드 링크 onclick: "${downFileFn}"`)

      // 파일 ID 추출 (예: downFile('25954-upload_form.xls'))
      const match = downFileFn.match(/downFile\(['"]([^'"]+)['"]\)/)
      const fileId = match?.[1] ?? ''
      info(`추출된 파일 ID: "${fileId}"`)

      if (fileId) {
        // 다운로드 시도
        const dlDir = path.join(STORAGE, 'sample_dl')
        if (!fs.existsSync(dlDir)) fs.mkdirSync(dlDir, { recursive: true })

        const [download] = await Promise.all([
          page.waitForEvent('download', { timeout: 10000 }),
          tf.evaluate((oid) => {
            if (typeof window.downFile === 'function') window.downFile(oid)
          }, fileId),
        ]).catch(() => [null])

        if (download) {
          samplePath = path.join(dlDir, fileId.split('/').pop())
          await download.saveAs(samplePath)
          pass(`샘플 파일 다운로드: ${fileId}`)
        } else {
          // 직접 URL 시도
          const candidates = [
            `${TOEVER_BASE}/deliveryupload/${fileId}`,
            `${TOEVER_BASE}/file/${fileId}`,
            `${TOEVER_BASE}/common/download.do?fileId=${fileId}`,
          ]
          for (const url of candidates) {
            try {
              const [dl2] = await Promise.all([
                page.waitForEvent('download', { timeout: 6000 }),
                page.goto(url, { waitUntil: 'domcontentloaded', timeout: 8000 }),
              ]).catch(() => [null])
              if (dl2) {
                samplePath = path.join(dlDir, fileId.split('/').pop())
                await dl2.saveAs(samplePath)
                pass(`샘플 파일 직접 다운로드: ${url}`)
                break
              }
            } catch { /* 다음 후보 */ }
          }
          if (!samplePath) {
            skip(`샘플 파일 다운로드 실패 (downFile 비동기 팝업 방식)`)
          }
        }
      } else {
        skip('downFile 파일 ID 추출 실패')
      }
    } finally {
      await browser.close().catch(() => {})
    }

    if (samplePath && fs.existsSync(samplePath)) {
      info(`샘플 파일 경로: ${samplePath}`)

      // 샘플 시그니처 확인
      const sampleSig = detectFileType(samplePath)
      info(`샘플 헤더: ${sampleSig.hex} (BIFF8: ${sampleSig.isBiff8}, ZIP: ${sampleSig.isZip})`)

      // 샘플 시트 구조 확인
      const wbSample = XLSX.readFile(samplePath, { cellText: false, raw: false })
      info(`샘플 시트: ${wbSample.SheetNames.join(', ')}`)
      const wsSample = wbSample.Sheets['Sheet1']
      const sampleA1 = wsSample?.['A1']?.v
      const sampleB1 = wsSample?.['B1']?.v
      info(`샘플 A1: "${sampleA1}" B1: "${sampleB1}"`)

      // 생성 파일과 비교
      if (A1 === sampleA1 && B1 === sampleB1) {
        pass(`헤더 호환성: 생성파일="${A1}/${B1}" = 샘플="${sampleA1}/${sampleB1}"`)
      } else {
        fail(`헤더 불일치: 생성파일="${A1}/${B1}" ≠ 샘플="${sampleA1}/${sampleB1}"`)
      }

      // 시트 구조 비교
      const ourSheets    = wbRead.SheetNames.sort().join(',')
      const sampleSheets = wbSample.SheetNames.sort().join(',')
      info(`생성 파일 시트: ${ourSheets}`)
      info(`샘플 파일 시트: ${sampleSheets}`)
      if (ourSheets === sampleSheets) {
        pass(`시트 구조 동일: ${ourSheets}`)
      } else {
        info(`시트 구조 차이: 생성="${ourSheets}" vs 샘플="${sampleSheets}" (업로드에는 Sheet1만 사용)`)
      }
    }
  }

  // ── 7. .xlsx 시그니처 없음 재확인 ───────────────────────────────
  section('7. .xlsx 위장 파일 아님 최종 확인')
  const finalSig = detectFileType(filePath)
  if (!finalSig.isZip && finalSig.isBiff8) {
    pass('.xlsx로 이름만 바꾼 파일 아님 — 진짜 BIFF8 xls 바이너리 확인')
  } else {
    fail(`.xlsx 위장 파일 의심: ZIP=${finalSig.isZip} BIFF8=${finalSig.isBiff8}`)
  }

  // ── 최종 요약 ────────────────────────────────────────────────────
  console.log(`\n${C.bold('══════════════════════════════════════════════')}`)
  console.log(C.green(C.bold(`  ✓ 통과: ${passed}건`)))
  if (skipped > 0) console.log(C.yellow(C.bold(`  - 건너뜀: ${skipped}건`)))
  if (failed > 0) {
    console.log(C.red(C.bold(`  ✗ 실패: ${failed}건`)))
    for (const e of failList) console.log(C.red(`    - ${e}`))
  } else {
    console.log(C.green(C.bold(`  투에버 송장 업로드 파일 형식 정상`)))
  }
  console.log(C.bold('══════════════════════════════════════════════\n'))
  process.exit(failed > 0 ? 1 : 0)
}

main().catch(e => {
  console.error(C.red('[FATAL] ' + e.message))
  console.error(e.stack)
  process.exit(1)
})
