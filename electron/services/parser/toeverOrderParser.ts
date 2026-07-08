/**
 * 투에버 주문 파일 파서 (Ordering_data.xls 기준)
 *
 * 실제 파일 구조:
 * - HTML table 기반 .xls (HTML_XLS)
 * - 인코딩: KSC5601 (CP949)
 * - 헤더: 주문번호, 수령자명, 상품명, 옵션, 수량, 연락처, 주소, 배송메세지, 택배사, 송장번호
 * - 같은 주문번호가 상품 라인마다 반복될 수 있음 (다중 상품 주문)
 *
 * 핵심 주의사항:
 * - XLSX 라이브러리로 파싱 시 주문번호(0100012026070800002)가
 *   1.00012E+17 형태로 깨짐 → HTML 직접 파싱 필수
 * - x:str 속성 셀은 문자열로 처리
 * - 앞자리 0 절대 손실 금지
 */

import XLSX from 'xlsx'
import iconv from 'iconv-lite'
import fs from 'fs'
import crypto from 'crypto'
import { detectFileFormat } from './fileDetector'
import { parseHtmlTableFile, buildColumnMap, getCell } from './htmlTableParser'
import { toSafeString, isScientificNotationRisk, isValidOrderNo } from './safeString'
import type { ToeverOrderRow } from '../../../shared/types'

export interface ParseResult {
  rows: ToeverOrderRow[]
  warnings: string[]
  errors: string[]
}

/** 투에버 주문 파일의 컬럼 헤더 별칭 매핑 */
const HEADER_ALIASES: Record<string, string> = {
  '주문번호':   '주문번호',
  '수령자명':   '수령자명',
  '수령자이름': '수령자명',
  '상품명':     '상품명',
  '옵션':       '옵션',
  '옵션명':     '옵션',
  '수량':       '수량',
  '연락처':     '연락처',
  '전화번호':   '연락처',
  '수령자전화': '연락처',
  '주소':       '주소',
  '수령자주소': '주소',
  '배송메세지': '배송메세지',
  '배송메시지': '배송메세지',
  '배송메모':   '배송메세지',
  '택배사':     '택배사',
  '송장번호':   '송장번호',
}

const REQUIRED_HEADERS = ['주문번호', '수령자명', '상품명', '수량', '연락처', '주소']

export function parseToeverOrderFile(filePath: string): ParseResult {
  const fmt = detectFileFormat(filePath)
  const warnings: string[] = []
  const errors: string[] = []

  // HTML 기반 xls → 직접 HTML 파싱 (XLSX 라이브러리 사용 시 숫자 깨짐 문제 방지)
  if (fmt === 'HTML_XLS') {
    return parseHtmlXls(filePath, warnings, errors)
  }

  // XLSX / BIFF → XLSX 라이브러리 사용 (260708(1).xlsx 형식)
  if (fmt === 'XLSX' || fmt === 'BIFF_XLS') {
    return parseExcelXls(filePath, fmt, warnings, errors)
  }

  errors.push(`지원하지 않는 파일 포맷: ${fmt}`)
  return { rows: [], warnings, errors }
}

// ============================================================
// HTML_XLS 파싱 (투에버 Ordering_data.xls 실제 포맷)
// ============================================================

function parseHtmlXls(filePath: string, warnings: string[], errors: string[]): ParseResult {
  let parsed: ReturnType<typeof parseHtmlTableFile>
  try {
    parsed = parseHtmlTableFile(filePath)
  } catch (e) {
    errors.push(`HTML 파싱 오류: ${e}`)
    return { rows: [], warnings, errors }
  }

  if (parsed.headers.length === 0) {
    errors.push('헤더를 찾을 수 없습니다.')
    return { rows: [], warnings, errors }
  }

  // 헤더 정규화 (별칭 처리)
  const normalizedHeaders = parsed.headers.map(h => HEADER_ALIASES[h.trim()] ?? h.trim())
  const colMap = buildColumnMap(normalizedHeaders)

  // 필수 헤더 검증
  const missing = REQUIRED_HEADERS.filter(h => !colMap.has(h))
  if (missing.length > 0) {
    errors.push(`필수 헤더 누락: ${missing.join(', ')} (실제 헤더: ${parsed.headers.join(', ')})`)
    return { rows: [], warnings, errors }
  }

  const rows: ToeverOrderRow[] = []

  for (let i = 0; i < parsed.rows.length; i++) {
    const row = parsed.rows[i]
    const rowNum = i + 2  // 헤더 다음 행부터 2번째

    const toever_order_no = getCell(row, colMap, '주문번호') ?? ''
    const invoice_no_raw  = getCell(row, colMap, '송장번호')

    // 주문번호 검증
    if (!toever_order_no) {
      warnings.push(`행 ${rowNum}: 주문번호 없음 → 건너뜀`)
      continue
    }

    if (isScientificNotationRisk(toever_order_no)) {
      errors.push(`행 ${rowNum}: 주문번호 과학적 표기법 감지 → ${toever_order_no}`)
      continue
    }

    // 송장번호 검증
    const invoice_no = invoice_no_raw
      ? isScientificNotationRisk(invoice_no_raw)
        ? (() => { errors.push(`행 ${rowNum}: 송장번호 과학적 표기법 → ${invoice_no_raw}`); return null })()
        : invoice_no_raw
      : null

    const qty_str = getCell(row, colMap, '수량') ?? '1'
    const qty = parseInt(qty_str, 10)

    rows.push({
      toever_order_no,
      receiver_name:    getCell(row, colMap, '수령자명') ?? '',
      product_name:     getCell(row, colMap, '상품명') ?? '',
      option_name:      getCell(row, colMap, '옵션') || null,
      quantity:         isNaN(qty) ? 1 : qty,
      receiver_phone:   getCell(row, colMap, '연락처') ?? '',
      receiver_address: getCell(row, colMap, '주소') ?? '',
      delivery_message: getCell(row, colMap, '배송메세지') || null,
      courier_name:     getCell(row, colMap, '택배사') || null,
      invoice_no,
    })
  }

  if (rows.length === 0) {
    warnings.push('파싱된 데이터 행이 없습니다.')
  }

  return { rows, warnings, errors }
}

// ============================================================
// XLSX / BIFF_XLS 파싱 (260708(1).xlsx 형식)
// ============================================================

function parseExcelXls(
  filePath: string,
  fmt: 'XLSX' | 'BIFF_XLS',
  warnings: string[],
  errors: string[]
): ParseResult {
  let workbook: XLSX.WorkBook
  try {
    if (fmt === 'BIFF_XLS') {
      const buf = fs.readFileSync(filePath)
      workbook = XLSX.read(buf, { type: 'buffer', codepage: 949 })
    } else {
      workbook = XLSX.readFile(filePath)
    }
  } catch (e) {
    errors.push(`파일 파싱 오류: ${e}`)
    return { rows: [], warnings, errors }
  }

  // 시트 선택: Ordering_data 또는 Sheet1
  const sheetName =
    workbook.SheetNames.find(s => s === 'Ordering_data') ??
    workbook.SheetNames[0]
  if (!sheetName) {
    errors.push('시트가 없습니다.')
    return { rows: [], warnings, errors }
  }

  const sheet = workbook.Sheets[sheetName]
  // raw:false → 셀 서식 적용 텍스트로 읽음 (숫자 변환 방지)
  const rawData = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    raw: false,
    defval: '',
  })

  if (rawData.length === 0) {
    warnings.push('데이터가 없습니다.')
    return { rows: [], warnings, errors }
  }

  const firstRow = rawData[0]
  const actualHeaders = Object.keys(firstRow)

  // 헤더 정규화
  const normalizedMap: Record<string, string> = {}
  for (const h of actualHeaders) {
    const normalized = HEADER_ALIASES[h.trim()] ?? h.trim()
    normalizedMap[h] = normalized
  }

  // 필수 헤더 검증
  const normalizedSet = new Set(Object.values(normalizedMap))
  const missing = REQUIRED_HEADERS.filter(h => !normalizedSet.has(h))
  if (missing.length > 0) {
    errors.push(`필수 헤더 누락: ${missing.join(', ')}`)
    return { rows: [], warnings, errors }
  }

  const rows: ToeverOrderRow[] = []

  for (let i = 0; i < rawData.length; i++) {
    const raw = rawData[i]
    const get = (field: string): string => {
      for (const [k, v] of Object.entries(normalizedMap)) {
        if (v === field) {
          return toSafeString(raw[k])
        }
      }
      return ''
    }

    const toever_order_no = get('주문번호')
    if (!toever_order_no) {
      warnings.push(`행 ${i + 2}: 주문번호 없음 → 건너뜀`)
      continue
    }
    if (isScientificNotationRisk(toever_order_no)) {
      errors.push(`행 ${i + 2}: 주문번호 과학적 표기법 감지 → ${toever_order_no}`)
      continue
    }

    const invoice_no_raw = get('송장번호')
    const invoice_no = invoice_no_raw
      ? isScientificNotationRisk(invoice_no_raw) ? null : invoice_no_raw
      : null

    const qty = parseInt(get('수량') || '1', 10)

    rows.push({
      toever_order_no,
      receiver_name:    get('수령자명'),
      product_name:     get('상품명'),
      option_name:      get('옵션') || null,
      quantity:         isNaN(qty) ? 1 : qty,
      receiver_phone:   get('연락처'),
      receiver_address: get('주소'),
      delivery_message: get('배송메세지') || null,
      courier_name:     get('택배사') || null,
      invoice_no,
    })
  }

  return { rows, warnings, errors }
}

/**
 * 주문 내용의 해시값을 계산한다.
 * 같은 주문번호인데 내용이 바뀌었는지 감지하는 데 사용한다.
 */
export function computeOrderHash(data: {
  receiver_name: string
  receiver_phone: string
  receiver_address: string
  product_name: string
  option_name: string | null
  quantity: number
  delivery_message: string | null
}): string {
  const str = [
    data.receiver_name,
    data.receiver_phone,
    data.receiver_address,
    data.product_name,
    data.option_name ?? '',
    String(data.quantity),
    data.delivery_message ?? '',
  ].join('|')
  return crypto.createHash('sha256').update(str, 'utf8').digest('hex').slice(0, 16)
}
