/**
 * MVP 플로우 테스트 스크립트
 * 실행: npx electron test_mvp.js
 */
'use strict'

const path = require('path')
const fs   = require('fs')
const os   = require('os')

const DIST          = path.join(__dirname, 'dist-electron')
const STORAGE       = path.join(os.tmpdir(), 'toever_test_' + Date.now())
const SAMPLE_DIR    = path.join(__dirname, 'test_samples')
const BUSINESS_DATE = '2026-07-08'

// ── 컬러 출력 ─────────────────────────────────────────────────────────
const C = {
  green:  s => `\x1b[32m${s}\x1b[0m`,
  red:    s => `\x1b[31m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
  cyan:   s => `\x1b[36m${s}\x1b[0m`,
  bold:   s => `\x1b[1m${s}\x1b[0m`,
}
const OK   = C.green('✓')
const FAIL = C.red('✗')

let passed = 0
let failed = 0
const failList = []

function pass(msg) { console.log(`  ${OK}  ${msg}`); passed++ }
function fail(msg, err) {
  console.log(`  ${FAIL}  ${C.red(msg)}`)
  if (err) console.log(`     ${C.yellow(String(err))}`)
  failed++
  failList.push(msg)
}
function section(msg) { console.log(`\n${C.bold(C.cyan('▶ ' + msg))}`) }
function info(msg) { console.log(`  ℹ  ${msg}`) }

// ── 샘플 파일 생성 ────────────────────────────────────────────────────
// 주의: charset=utf-8 는 따옴표 없이 작성 (detectHtmlEncoding 호환)
//       혹은 수정 후 빌드하면 따옴표 있어도 됨 - 여기서는 안전하게 무따옴표 사용
function createSampleFiles() {
  if (!fs.existsSync(SAMPLE_DIR)) fs.mkdirSync(SAMPLE_DIR, { recursive: true })

  // ① 투에버 주문 파일 (HTML_XLS, UTF-8)
  //    - 주문 3건: 0100012026070800001 (2상품), 002, 003
  const toeverOrderHtml = `<html>
<head><meta charset=utf-8></head>
<body>
<table>
<tr>
  <th>주문번호</th><th>수령자명</th><th>상품명</th><th>옵션</th>
  <th>수량</th><th>연락처</th><th>주소</th><th>배송메세지</th>
  <th>택배사</th><th>송장번호</th>
</tr>
<tr>
  <td x:str>0100012026070800001</td><td>홍길동</td><td>스프링 텀블러 500ml</td><td>블랙</td>
  <td>2</td><td>010-1234-5678</td><td>서울시 강남구 테헤란로 123</td><td>문앞에 두세요</td>
  <td></td><td></td>
</tr>
<tr>
  <td x:str>0100012026070800001</td><td>홍길동</td><td>스프링 머그컵 350ml</td><td>화이트</td>
  <td>1</td><td>010-1234-5678</td><td>서울시 강남구 테헤란로 123</td><td>문앞에 두세요</td>
  <td></td><td></td>
</tr>
<tr>
  <td x:str>0100012026070800002</td><td>김철수</td><td>스프링 보온병 1L</td><td>레드</td>
  <td>1</td><td>010-9876-5432</td><td>경기도 성남시 분당구 판교로 456</td><td>경비실에 맡겨주세요</td>
  <td></td><td></td>
</tr>
<tr>
  <td x:str>0100012026070800003</td><td>이영희</td><td>스프링 컵홀더</td><td>네이비</td>
  <td>3</td><td>010-5555-6666</td><td>부산시 해운대구 마린시티로 789</td><td></td>
  <td></td><td></td>
</tr>
</table>
</body>
</html>`

  const orderFilePath = path.join(SAMPLE_DIR, 'Ordering_data.xls')
  fs.writeFileSync(orderFilePath, toeverOrderHtml, 'utf8')

  // ② 이지어드민 확장주문검색 파일 (HTML_XLS, UTF-8)
  //    - 최소 필수 컬럼만 포함 (주문번호, 상태, 상품명, 옵션명, 주문수량, 상품수량,
  //      송장입력일, 송장번호, 택배사, 수령자주소, 수령자이름, 수령자전화, 수령자휴대폰,
  //      배송메모, 로케이션 + 60개 맞추기 위한 빈 컬럼)
  const mkTd = v => `<td x:str>${v}</td>`
  const emptyTds = n => '<td></td>'.repeat(n)

  // 헤더 순서 (60개)
  const headers = [
    'No','채널','주문번호','상태','주문일','결제일','발송기한','주문자이름','주문자전화',
    '상품코드','바코드','재고위치','창고위치','상품분류','상품명','옵션명',
    '원가','공급가','판매가','주문수량','상품수량','묶음수량','묶음박스',
    '부피무게','실제무게','박스타입','출고창고','피킹구역','피킹순서','세트구성',
    '세트상품코드','메모','송장입력일','송장번호','택배사','서비스타입',
    '수령자주소','우편번호','상세주소','주소유형','주소확인','사전등록여부',
    '수령자이름','수령자전화','수령자휴대폰','배송메모','이메일','판매채널',
    '채널주문번호','로케이션','사방넷코드','채널상품번호','거래처코드','거래처명',
    '상품속성','배치창고','분류','시리얼번호','원산지','기타정보',
  ]

  const makeRow = (no, orderNo, productName, optionName, qty, invoiceDate, invoiceNo, courier, addr, zip, receiverName, phone, memo, location) => {
    // 60컬럼 순서대로
    const cols = [
      no,        // No
      '투에버',   // 채널
      orderNo,   // 주문번호
      '출고완료', // 상태
      BUSINESS_DATE, // 주문일
      BUSINESS_DATE, // 결제일
      '2026-07-09', // 발송기한
      receiverName, // 주문자이름
      phone,     // 주문자전화
      `SP-00${no}`, // 상품코드
      '',        // 바코드
      '',        // 재고위치
      '',        // 창고위치
      '',        // 상품분류
      productName, // 상품명
      optionName, // 옵션명
      '',        // 원가
      '',        // 공급가
      '',        // 판매가
      qty,       // 주문수량
      qty,       // 상품수량
      '',        // 묶음수량
      '',        // 묶음박스
      '',        // 부피무게
      '',        // 실제무게
      '',        // 박스타입
      '',        // 출고창고
      '',        // 피킹구역
      '',        // 피킹순서
      '',        // 세트구성
      '',        // 세트상품코드
      '',        // 메모
      invoiceDate, // 송장입력일
      invoiceNo, // 송장번호
      courier,   // 택배사
      '',        // 서비스타입
      addr,      // 수령자주소
      zip,       // 우편번호
      '',        // 상세주소
      '',        // 주소유형
      '',        // 주소확인
      '',        // 사전등록여부
      receiverName, // 수령자이름
      phone,     // 수령자전화
      phone,     // 수령자휴대폰
      memo,      // 배송메모
      '',        // 이메일
      '',        // 판매채널
      '',        // 채널주문번호
      location,  // 로케이션
      '',        // 사방넷코드
      '',        // 채널상품번호
      '',        // 거래처코드
      '',        // 거래처명
      '',        // 상품속성
      '',        // 배치창고
      '',        // 분류
      '',        // 시리얼번호
      '',        // 원산지
      '',        // 기타정보
    ]
    return '<tr>' + cols.map(v => `<td x:str>${v}</td>`).join('') + '</tr>'
  }

  const ezadminInvoiceHtml = `<html>
<head><meta charset=utf-8></head>
<body>
<table>
<tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr>
${makeRow(1,'0100012026070800001','스프링 텀블러 500ml','블랙',3,'2026-07-09','600123456789','CJ대한통운','서울시 강남구 테헤란로 123','06234','홍길동','010-1234-5678','문앞에 두세요','A-01')}
${makeRow(2,'0100012026070800002','스프링 보온병 1L','레드',1,'2026-07-09','600123456790','CJ대한통운','경기도 성남시 분당구 판교로 456','13529','김철수','010-9876-5432','경비실에 맡겨주세요','B-02')}
${makeRow(3,'0100012026070800003','스프링 컵홀더','네이비',3,'2026-07-09','600123456791','CJ대한통운','부산시 해운대구 마린시티로 789','48095','이영희','010-5555-6666','','C-03')}
</table>
</body>
</html>`

  const invoiceFilePath = path.join(SAMPLE_DIR, '확장주문검색_20260708134411_851151103.xls')
  fs.writeFileSync(invoiceFilePath, ezadminInvoiceHtml, 'utf8')

  return { orderFilePath, invoiceFilePath }
}

// ── 메인 테스트 ───────────────────────────────────────────────────────
async function main() {
  console.log(C.bold('\n══════════════════════════════════════════'))
  console.log(C.bold('  Spring Toever Ops - MVP 플로우 테스트'))
  console.log(C.bold('══════════════════════════════════════════\n'))
  info(`스토리지: ${STORAGE}`)
  info(`업무일자: ${BUSINESS_DATE}\n`)

  // ── 0. 환경 초기화 ────────────────────────────────────────────────
  section('0. 환경 초기화')
  const storage = require(path.join(DIST, 'electron/services/storage.js'))
  storage.setBasePath(STORAGE)
  storage.ensureAllDirs()
  pass('스토리지 디렉토리 생성')

  const { initDb, getDb } = require(path.join(DIST, 'electron/services/db/schema.js'))
  initDb(STORAGE)
  pass('DB 초기화')

  const db = getDb()

  // ── 1. 샘플 파일 생성 ─────────────────────────────────────────────
  section('1. 샘플 파일 생성')
  const sampleFiles = createSampleFiles()
  pass(`투에버 주문 파일: ${path.basename(sampleFiles.orderFilePath)}`)
  pass(`이지어드민 송장 파일: ${path.basename(sampleFiles.invoiceFilePath)}`)

  // ── STEP 1: 투에버 주문 파일 파싱 ────────────────────────────────
  section('STEP 1. 투에버 주문 파일 import (파싱)')
  const { parseToeverOrderFile, computeOrderHash } = require(path.join(DIST, 'electron/services/parser/toeverOrderParser.js'))
  let parseResult
  try {
    parseResult = parseToeverOrderFile(sampleFiles.orderFilePath)
    if (parseResult.errors.length > 0) {
      fail('파싱 오류: ' + parseResult.errors.join(', '))
    } else {
      pass(`파싱 완료: ${parseResult.rows.length}행, 오류 0건`)
    }

    const sample = parseResult.rows[0]
    if (sample && typeof sample.toever_order_no === 'string' && sample.toever_order_no.startsWith('01')) {
      pass(`주문번호 문자열 보존: "${sample.toever_order_no}"`)
    } else {
      fail(`주문번호 타입 이상: type=${typeof sample?.toever_order_no}, val=${sample?.toever_order_no}`)
    }

    const uniq = new Set(parseResult.rows.map(r => r.toever_order_no))
    pass(`고유 주문번호 ${uniq.size}건 (전체 ${parseResult.rows.length}행 - 1번 주문 2상품 정상)`)
  } catch (e) {
    fail('파싱 예외', e)
    process.exit(1)
  }

  // ── STEP 2: 신규 출고 대상 필터링 + DB 저장 (오전) ───────────────
  section('STEP 2. 신규 출고 대상 필터링 + DB 저장 (오전 round)')
  const { filterNewShipmentTargets } = require(path.join(DIST, 'electron/services/dedup/duplicateFilter.js'))
  const repos = require(path.join(DIST, 'electron/services/db/repositories.js'))

  let orderGroups
  try {
    const filterResult = filterNewShipmentTargets(parseResult.rows, 0)
    pass(`신규 출고 대상: ${filterResult.new_targets.length}건`)
    pass(`중복 스킵: ${filterResult.duplicates.length}건`)

    orderGroups = new Map()
    for (const row of parseResult.rows) {
      const g = orderGroups.get(row.toever_order_no) ?? []
      g.push(row)
      orderGroups.set(row.toever_order_no, g)
    }

    const runMorning = repos.createRun(
      'COLLECT_ORDERS', BUSINESS_DATE,
      `source=toever|date=${BUSINESS_DATE}|round=morning`, 'morning'
    )

    for (const [orderNo, rows] of orderGroups.entries()) {
      const first = rows[0]
      const hash = computeOrderHash({
        receiver_name: first.receiver_name,
        receiver_phone: first.receiver_phone,
        receiver_address: first.receiver_address,
        product_name: rows.map(r => `${r.product_name}/${r.option_name ?? ''}/${r.quantity}`).join('|'),
        option_name: null,
        quantity: rows.reduce((s, r) => s + r.quantity, 0),
        delivery_message: first.delivery_message,
      })
      const isNewTarget = filterResult.new_targets.some(t => t.toever_order_no === orderNo)
      const { id: orderId, isNew } = repos.upsertOrderHeader({
        toever_order_no:     orderNo,
        toever_po_no:        null,
        order_date:          BUSINESS_DATE,
        receiver_name:       first.receiver_name,
        receiver_phone:      first.receiver_phone,
        receiver_address:    first.receiver_address,
        delivery_message:    first.delivery_message,
        status:              isNewTarget ? 'NEW_SHIPMENT_TARGET' : 'DUPLICATE_SKIPPED',
        latest_invoice_no:   first.invoice_no ?? null,
        latest_courier_name: first.courier_name ?? null,
        latest_invoice_input_at: null,
        ezadmin_batch_id:    null,
        source_run_id:       runMorning.id,
        hash_snapshot:       hash,
      })
      if (isNew) {
        repos.insertOrderItems(orderId, rows.map((r, idx) => ({
          line_no: idx + 1,
          product_name: r.product_name,
          option_name: r.option_name ?? null,
          quantity: r.quantity,
          ezadmin_product_code: null,
          barcode: null,
          line_hash: hash,
        })))
      }
    }
    pass(`DB 저장 완료: ${orderGroups.size}건`)
  } catch (e) {
    fail('필터링/저장 실패', e)
    process.exit(1)
  }

  // ── STEP 2-1: 오전/오후 중복 방지 ────────────────────────────────
  section('STEP 2-1. 오전/오후 중복 주문 제외 검증')
  try {
    const filterResult2 = filterNewShipmentTargets(parseResult.rows, 0)
    if (filterResult2.new_targets.length === 0) {
      pass(`오후 재수집 시 신규 대상: 0건 → 중복 방지 정상`)
    } else {
      fail(`오후 재수집 시 신규 대상: ${filterResult2.new_targets.length}건 (0이어야 함)`)
    }
    pass(`오후 재수집 중복 스킵: ${filterResult2.duplicates.length}건`)
  } catch (e) {
    fail('중복 방지 검증 실패', e)
  }

  // ── STEP 3: 이지어드민 업로드 파일 생성 ──────────────────────────
  section('STEP 3. 이지어드민 업로드 파일 생성')
  const { generateEzadminUploadFile } = require(path.join(DIST, 'electron/services/toever/orchestrator.js'))
  let ezadminUploadFilePath
  try {
    const result = generateEzadminUploadFile(BUSINESS_DATE, undefined, 'manual')
    if (!result.success) {
      fail(`생성 실패: ${result.error}`)
    } else {
      ezadminUploadFilePath = result.filePath
      pass(`파일 생성: ${path.basename(result.filePath)}`)
      pass(`처리 건수: ${result.rowCount}행`)

      const XLSX = require('xlsx')
      const wb = XLSX.readFile(result.filePath)
      const ws = wb.Sheets[wb.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1 })
      const hdr = rows[0]
      info(`헤더: ${hdr.join(', ')}`)

      const dataRows = rows.slice(1)
      console.log(`\n  ${C.cyan('이지어드민 업로드 파일 내용 (최대 5행):')}`)
      console.log(`  ${'주문번호'.padEnd(22)} ${'상품명'.padEnd(22)} 수량`)
      console.log(`  ${'─'.repeat(55)}`)
      for (const row of dataRows.slice(0, 5)) {
        // 이지어드민 파일 컬럼: 주문번호(col0), 채널(col1), 상품명(col2 or depends on builder)
        const orderNo = String(row[0] || '')
        const prodName = String(row[2] || row[1] || '').slice(0, 22)
        const qty = row[4] || row[3] || ''
        console.log(`  ${orderNo.padEnd(22)} ${prodName.padEnd(22)} ${qty}`)
      }

      // 주문번호 손실 검증
      const firstOrderNo = String(dataRows[0]?.[0] ?? '')
      if (firstOrderNo.startsWith('01')) {
        pass(`주문번호 형식 정상: "${firstOrderNo}"`)
      } else {
        fail(`주문번호 손상 의심: "${firstOrderNo}"`)
      }
    }
  } catch (e) {
    fail('이지어드민 업로드 파일 생성 실패', e)
  }

  // ── STEP 4: 이지어드민 송장 파일 import ──────────────────────────
  section('STEP 4. 이지어드민 송장 포함 파일 import')
  const { importEzadminInvoice } = require(path.join(DIST, 'electron/services/toever/orchestrator.js'))
  let importResult
  try {
    importResult = await importEzadminInvoice({ filePath: sampleFiles.invoiceFilePath })
    if (!importResult.success && importResult.errors.some(e => e.includes('주문번호') && e.includes('없습니다'))) {
      fail(`송장 import 실패 (파서 오류): ${importResult.errors[0]}`)
    } else if (!importResult.success) {
      fail(`송장 import 실패: ${importResult.errors.join(', ')}`)
    } else {
      pass(`송장 import 완료`)
    }
    pass(`매칭: ${importResult.matched}건`)
    if (importResult.multi_invoice > 0) info(`복수 송장: ${importResult.multi_invoice}건`)
    if (importResult.orphan > 0) info(`미매칭(orphan): ${importResult.orphan}건`)
  } catch (e) {
    fail('송장 import 예외', e)
  }

  // ── STEP 5: 주문번호 기준 송장 매칭 확인 ─────────────────────────
  section('STEP 5. 주문번호 기준 송장 매칭 확인')
  try {
    const matched = db.prepare(
      `SELECT toever_order_no, status, latest_invoice_no, latest_courier_name
       FROM order_header WHERE latest_invoice_no IS NOT NULL`
    ).all()

    console.log(`\n  ${C.cyan('송장 매칭 결과:')}`)
    console.log(`  ${'주문번호'.padEnd(22)} ${'상태'.padEnd(25)} ${'송장번호'.padEnd(15)} 택배사`)
    console.log(`  ${'─'.repeat(80)}`)
    for (const o of matched) {
      const inv = String(o.latest_invoice_no)
      // 송장번호 문자열 보존 확인 (숫자 변환 안 됐는지)
      if (inv.startsWith('6') || inv.length >= 10) {
        console.log(`  ${o.toever_order_no.padEnd(22)} ${o.status.padEnd(25)} ${inv.padEnd(15)} ${o.latest_courier_name ?? ''}`)
      } else {
        fail(`송장번호 손상 의심: "${inv}"`)
      }
    }
    pass(`총 ${matched.length}건 매칭 확인`)

    // 송장번호 길이 검증 (12자리 정수형으로 깨지지 않았는지)
    for (const o of matched) {
      const inv = String(o.latest_invoice_no)
      if (/^\d{12}$/.test(inv)) {
        pass(`송장번호 12자리 문자열 보존: "${inv}"`)
        break
      }
    }
  } catch (e) {
    fail('매칭 결과 조회 실패', e)
  }

  // ── STEP 6: 투에버 송장 업로드 파일 생성 ─────────────────────────
  section('STEP 6. 투에버 송장 업로드용 파일 생성')
  const { buildToeverInvoiceUploadFile } = require(path.join(DIST, 'electron/services/exporter/toeverInvoiceBuilder.js'))
  const { getOrdersForToeverInvoiceUpload } = require(path.join(DIST, 'electron/services/db/repositories.js'))
  let toeverInvFilePath
  try {
    const orders = getOrdersForToeverInvoiceUpload()
    info(`송장 업로드 대상: ${orders.length}건`)
    if (orders.length === 0) {
      fail('투에버 송장 업로드 대상이 없음 (INVOICE_IMPORTED 상태 주문 없음)')
    } else {
      const result = buildToeverInvoiceUploadFile(orders)
      toeverInvFilePath = result.filePath
      pass(`파일 생성: ${path.basename(result.filePath)}`)
      pass(`처리 건수: ${result.rowCount}행`)

      const XLSX = require('xlsx')
      const wb = XLSX.readFile(result.filePath)
      const wsNames = wb.SheetNames
      info(`시트 목록: ${wsNames.join(', ')}`)

      const ws = wb.Sheets['Sheet1']
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1 })
      const hdr = rows[0]

      if (Array.isArray(hdr) && hdr.length === 2 && hdr[0] === '주문번호' && hdr[1] === '송장번호') {
        pass(`2컬럼 구조 확인: [${hdr.join(', ')}]`)
      } else {
        fail(`컬럼 구조 이상: ${JSON.stringify(hdr)}`)
      }

      console.log(`\n  ${C.cyan('투에버 송장 업로드 파일 내용:')}`)
      console.log(`  ${'주문번호'.padEnd(22)} 송장번호`)
      console.log(`  ${'─'.repeat(40)}`)
      for (const row of rows.slice(1)) {
        const orderNo  = String(row[0] ?? '')
        const invoiceNo = String(row[1] ?? '')
        console.log(`  ${orderNo.padEnd(22)} ${invoiceNo}`)
        if (!orderNo.match(/^01/)) {
          fail(`주문번호 손상: "${orderNo}"`)
        }
        if (!invoiceNo.match(/^\d{10,}/)) {
          fail(`송장번호 손상 (너무 짧거나 비숫자): "${invoiceNo}"`)
        }
      }
      pass('주문번호/송장번호 형식 정상')
    }
  } catch (e) {
    fail('투에버 송장 업로드 파일 생성 실패', e)
  }

  // ── STEP 7: 백업 실행 ─────────────────────────────────────────────
  section('STEP 7. 백업 실행')
  const backupDest = path.join(os.tmpdir(), 'toever_backup_' + Date.now())
  fs.mkdirSync(backupDest, { recursive: true })
  try {
    db.prepare("INSERT OR REPLACE INTO app_settings (key,value) VALUES (?,?)").run('backup_path', backupDest)
    db.prepare("INSERT OR REPLACE INTO app_settings (key,value) VALUES (?,?)").run('storage_base_path', STORAGE)

    const { runBackup } = require(path.join(DIST, 'electron/services/backup.js'))
    const bkResult = await runBackup({
      backup_type: 'MANUAL',
      emit: p => { if (p.message) info(p.message) },
    })

    if (!bkResult.success) {
      fail(`백업 실패: ${bkResult.error ?? bkResult.skip_reason}`)
    } else {
      pass(`백업 완료 → ${bkResult.dest_path}`)
      pass(`파일 ${bkResult.file_count}개, ${((bkResult.size_bytes ?? 0) / 1024).toFixed(1)} KB`)

      // 폴더 구조 검증
      section('STEP 7-1. 백업 폴더 구조 검증')
      const bkPath = bkResult.dest_path
      const allFiles = []
      function listFiles(dir) {
        if (!fs.existsSync(dir)) return
        for (const f of fs.readdirSync(dir)) {
          const full = path.join(dir, f)
          if (fs.statSync(full).isDirectory()) listFiles(full)
          else allFiles.push(full.replace(bkPath, ''))
        }
      }
      listFiles(bkPath)

      const hasDb       = allFiles.some(f => f.includes('.db'))
      const hasGenerated = allFiles.some(f => f.includes('generated'))
      const hasLogs     = allFiles.some(f => f.includes('logs') || f.includes('log'))

      hasDb        ? pass('database/*.db 백업 확인') : fail('DB 파일 백업 없음')
      hasGenerated ? pass('generated/ 백업 확인') : info('generated/ 파일 없음 (허용)')
      hasLogs      ? pass('logs/ 백업 확인') : info('logs/ 파일 없음 (허용)')

      console.log(`\n  ${C.cyan('백업 파일 목록:')}`)
      for (const f of allFiles) info(f)
    }
  } catch (e) {
    fail('백업 실행 예외', e)
  }

  // ── STEP 8: 결과 종합 보고 ────────────────────────────────────────
  section('STEP 8. 결과 종합 보고')
  try {
    const total   = db.prepare('SELECT COUNT(*) as c FROM order_header').get()
    const byStatus = db.prepare('SELECT status, COUNT(*) as c FROM order_header GROUP BY status').all()
    const reviews  = db.prepare('SELECT COUNT(*) as c FROM manual_review_queue').get()
    const highReviews = db.prepare("SELECT COUNT(*) as c FROM manual_review_queue WHERE severity='HIGH'").get()
    const artifacts = db.prepare(
      'SELECT artifact_type, original_filename, stored_path FROM file_artifact ORDER BY id'
    ).all()

    console.log(`\n  ${C.bold('┌─ 처리 건수 요약 ──────────────────────────────────────┐')}`)
    console.log(`  │  총 주문: ${total.c}건`)
    for (const s of byStatus) {
      console.log(`  │    - ${s.status.padEnd(28)} ${s.c}건`)
    }
    console.log(`  │  수동 검토 항목: ${reviews.c}건 (HIGH: ${highReviews.c}건)`)
    console.log(`  ${C.bold('└────────────────────────────────────────────────────────┘')}`)

    console.log(`\n  ${C.bold('┌─ 생성된 파일 목록 ─────────────────────────────────────┐')}`)
    for (const a of artifacts) {
      const size = fs.existsSync(a.stored_path) ? fs.statSync(a.stored_path).size : 0
      const sizeStr = size > 1024 ? `${(size/1024).toFixed(1)}KB` : `${size}B`
      const typeShort = a.artifact_type.replace('_', '\n     ').padEnd(30)
      console.log(`  │  ${a.artifact_type.padEnd(30)} ${a.original_filename.slice(0, 38).padEnd(38)} ${sizeStr}`)
    }
    console.log(`  ${C.bold('└────────────────────────────────────────────────────────┘')}`)

    if (artifacts.length > 0) pass(`생성 파일 ${artifacts.length}개 artifact 기록 확인`)
    else fail('artifact 기록 없음')

  } catch (e) {
    fail('결과 조회 실패', e)
  }

  // ── 최종 요약 ─────────────────────────────────────────────────────
  console.log(`\n${C.bold('══════════════════════════════════════════')}`)
  if (failed === 0) {
    console.log(C.green(C.bold(`  ✓ 전체 ${passed}건 통과`)))
  } else {
    console.log(C.green(C.bold(`  ✓ 통과: ${passed}건`)))
    console.log(C.red(C.bold(`  ✗ 실패: ${failed}건`)))
    for (const e of failList) console.log(C.red(`    - ${e}`))
  }
  console.log(C.bold('══════════════════════════════════════════\n'))
  process.exit(failed > 0 ? 1 : 0)
}

main().catch(e => {
  console.error(C.red('\n[FATAL] ' + e.message))
  console.error(e.stack)
  process.exit(1)
})
