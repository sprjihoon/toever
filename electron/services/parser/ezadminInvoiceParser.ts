/**
 * 이지어드민 확장주문검색 파일 파서
 *
 * 실제 파일 구조 (확장주문검색_YYYYMMDDHHMMSS_NNNNN.xls 기준):
 * - HTML table 기반 .xls (HTML_XLS)
 * - 인코딩: UTF-8 (charset=utf-8)
 * - 60개 컬럼
 *
 * 핵심 컬럼:
 *   [2]  주문번호      ← 투에버 주문번호와 매칭 기준
 *   [3]  상태
 *   [9]  상품코드
 *   [10] 바코드
 *   [14] 상품명
 *   [15] 옵션명
 *   [19] 주문수량
 *   [20] 상품수량
 *   [32] 송장입력일
 *   [33] 송장번호      ← TEXT로 처리 필수
 *   [34] 택배사
 *   [36] 수령자주소
 *   [42] 수령자이름
 *   [43] 수령자전화
 *   [44] 수령자휴대폰
 *   [45] 배송메모
 *   [49] 로케이션
 *
 * 처리 규칙:
 * - 주문번호 + 같은 송장번호 반복 → 정상 중복, 1건만 반영
 * - 주문번호에 서로 다른 송장번호 2개 이상 → 수동검토
 * - 송장번호 없는 행 → 건너뜀
 */

import XLSX from 'xlsx'
import fs from 'fs'
import crypto from 'crypto'
import { detectFileFormat } from './fileDetector'
import { parseHtmlTableFile, buildColumnMap, getCell } from './htmlTableParser'
import { toSafeString, isScientificNotationRisk } from './safeString'
import type { EzadminInvoiceRow } from '../../../shared/types'

export interface EzadminParseResult {
  rows: EzadminInvoiceRow[]
  fileHash: string
  warnings: string[]
  errors: string[]
}

/**
 * 컬럼 헤더명 → EzadminInvoiceRow 필드 매핑
 * 실제 60컬럼 헤더 기준
 */
const COL_MAP: Record<string, keyof EzadminInvoiceRow> = {
  '주문번호':     'order_no',
  '상태':         'status',
  '상품코드':     'product_code',
  '바코드':       'barcode',
  '상품명':       'product_name',
  '옵션명':       'option_name',
  '옵션':         'option_name',
  '주문수량':     'order_qty',
  '상품수량':     'product_qty',
  '송장입력일':   'invoice_input_date',
  '송장번호':     'invoice_no',
  '택배사':       'courier_name',
  '수령자주소':   'receiver_address',
  '배송주소':     'receiver_address',
  '수령자이름':   'receiver_name',
  '수령자명':     'receiver_name',
  '수령자전화':   'receiver_phone',
  '수령자휴대폰': 'receiver_mobile',
  '배송메모':     'delivery_memo',
  '배송메세지':   'delivery_memo',
  '배송메시지':   'delivery_memo',
  '로케이션':     'location',
}

export function parseEzadminInvoiceFile(filePath: string): EzadminParseResult {
  const rawBuf = fs.readFileSync(filePath)
  const fileHash = crypto.createHash('sha256').update(rawBuf).digest('hex')
  const warnings: string[] = []
  const errors: string[] = []

  const fmt = detectFileFormat(filePath)

  if (fmt === 'HTML_XLS') {
    return parseHtmlInvoice(filePath, fileHash, warnings, errors)
  }

  if (fmt === 'XLSX' || fmt === 'BIFF_XLS') {
    return parseExcelInvoice(filePath, fmt, rawBuf, fileHash, warnings, errors)
  }

  errors.push(`지원하지 않는 파일 포맷: ${fmt}`)
  return { rows: [], fileHash, warnings, errors }
}

// ============================================================
// HTML_XLS 파싱 (확장주문검색 실제 포맷)
// ============================================================

function parseHtmlInvoice(
  filePath: string,
  fileHash: string,
  warnings: string[],
  errors: string[]
): EzadminParseResult {
  let parsed: ReturnType<typeof parseHtmlTableFile>
  try {
    parsed = parseHtmlTableFile(filePath)
  } catch (e) {
    errors.push(`HTML 파싱 오류: ${e}`)
    return { rows: [], fileHash, warnings, errors }
  }

  if (parsed.headers.length === 0) {
    errors.push('헤더를 찾을 수 없습니다.')
    return { rows: [], fileHash, warnings, errors }
  }

  const colMap = buildColumnMap(parsed.headers)

  if (!colMap.has('주문번호')) {
    errors.push(`헤더에 "주문번호" 컬럼이 없습니다. (실제 헤더: ${parsed.headers.slice(0, 10).join(', ')})`)
    return { rows: [], fileHash, warnings, errors }
  }
  if (!colMap.has('송장번호')) {
    warnings.push('헤더에 "송장번호" 컬럼이 없습니다.')
  }

  const rows: EzadminInvoiceRow[] = []

  for (let i = 0; i < parsed.rows.length; i++) {
    const row = parsed.rows[i]
    const rowNum = i + 2

    const order_no = getCell(row, colMap, '주문번호') ?? ''
    if (!order_no) {
      warnings.push(`행 ${rowNum}: 주문번호 없음 → 건너뜀`)
      continue
    }
    if (isScientificNotationRisk(order_no)) {
      errors.push(`행 ${rowNum}: 주문번호 과학적 표기법 → ${order_no}`)
      continue
    }

    const invoice_no = getCell(row, colMap, '송장번호')
    if (invoice_no && isScientificNotationRisk(invoice_no)) {
      errors.push(`행 ${rowNum}: 송장번호 과학적 표기법 → ${invoice_no}`)
      continue
    }

    const order_qty_str  = getCell(row, colMap, '주문수량')
    const product_qty_str = getCell(row, colMap, '상품수량')

    rows.push({
      order_no,
      status:             getCell(row, colMap, '상태'),
      product_code:       getCell(row, colMap, '상품코드'),
      barcode:            getCell(row, colMap, '바코드'),
      product_name:       getCell(row, colMap, '상품명'),
      option_name:        getCell(row, colMap, '옵션명'),
      order_qty:          order_qty_str  ? (parseInt(order_qty_str,  10) || null) : null,
      product_qty:        product_qty_str ? (parseInt(product_qty_str, 10) || null) : null,
      invoice_input_date: getCell(row, colMap, '송장입력일'),
      invoice_no,
      courier_name:       getCell(row, colMap, '택배사'),
      receiver_address:   getCell(row, colMap, '수령자주소'),
      receiver_name:      getCell(row, colMap, '수령자이름'),
      receiver_phone:     getCell(row, colMap, '수령자전화'),
      receiver_mobile:    getCell(row, colMap, '수령자휴대폰'),
      delivery_memo:      getCell(row, colMap, '배송메모'),
      location:           getCell(row, colMap, '로케이션'),
    })
  }

  return { rows, fileHash, warnings, errors }
}

// ============================================================
// XLSX / BIFF_XLS 파싱 (범용 fallback)
// ============================================================

function parseExcelInvoice(
  filePath: string,
  fmt: 'XLSX' | 'BIFF_XLS',
  rawBuf: Buffer,
  fileHash: string,
  warnings: string[],
  errors: string[]
): EzadminParseResult {
  let workbook: XLSX.WorkBook
  try {
    if (fmt === 'BIFF_XLS') {
      workbook = XLSX.read(rawBuf, { type: 'buffer', codepage: 949 })
    } else {
      workbook = XLSX.read(rawBuf, { type: 'buffer' })
    }
  } catch (e) {
    errors.push(`파일 파싱 오류: ${e}`)
    return { rows: [], fileHash, warnings, errors }
  }

  const sheetName = workbook.SheetNames[0]
  if (!sheetName) {
    errors.push('시트가 없습니다.')
    return { rows: [], fileHash, warnings, errors }
  }

  const sheet = workbook.Sheets[sheetName]
  const rawData = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    raw: false,
    defval: '',
  })

  if (rawData.length === 0) {
    warnings.push('데이터가 없습니다.')
    return { rows: [], fileHash, warnings, errors }
  }

  const actualHeaders = Object.keys(rawData[0])
  if (!actualHeaders.includes('주문번호')) {
    errors.push(`헤더에 "주문번호" 컬럼이 없습니다.`)
    return { rows: [], fileHash, warnings, errors }
  }

  const rows: EzadminInvoiceRow[] = []

  for (let i = 0; i < rawData.length; i++) {
    const raw = rawData[i]
    const rowNum = i + 2

    const order_no = toSafeString(raw['주문번호'])
    if (!order_no) { warnings.push(`행 ${rowNum}: 주문번호 없음`); continue }
    if (isScientificNotationRisk(order_no)) { errors.push(`행 ${rowNum}: 주문번호 과학적 표기법 → ${order_no}`); continue }

    const invoice_no_raw = toSafeString(raw['송장번호']) || null
    if (invoice_no_raw && isScientificNotationRisk(invoice_no_raw)) {
      errors.push(`행 ${rowNum}: 송장번호 과학적 표기법 → ${invoice_no_raw}`)
      continue
    }

    const oq = parseInt(toSafeString(raw['주문수량']), 10)
    const pq = parseInt(toSafeString(raw['상품수량']), 10)

    rows.push({
      order_no,
      status:             toSafeString(raw['상태']) || null,
      product_code:       toSafeString(raw['상품코드']) || null,
      barcode:            toSafeString(raw['바코드']) || null,
      product_name:       toSafeString(raw['상품명']) || null,
      option_name:        toSafeString(raw['옵션명'] ?? raw['옵션']) || null,
      order_qty:          isNaN(oq) ? null : oq,
      product_qty:        isNaN(pq) ? null : pq,
      invoice_input_date: toSafeString(raw['송장입력일']) || null,
      invoice_no:         invoice_no_raw,
      courier_name:       toSafeString(raw['택배사']) || null,
      receiver_address:   toSafeString(raw['수령자주소'] ?? raw['배송주소']) || null,
      receiver_name:      toSafeString(raw['수령자이름'] ?? raw['수령자명']) || null,
      receiver_phone:     toSafeString(raw['수령자전화']) || null,
      receiver_mobile:    toSafeString(raw['수령자휴대폰']) || null,
      delivery_memo:      toSafeString(raw['배송메모'] ?? raw['배송메세지']) || null,
      location:           toSafeString(raw['로케이션']) || null,
    })
  }

  return { rows, fileHash, warnings, errors }
}
