/**
 * 숫자/과학적 표기법을 안전하게 문자열로 변환하는 유틸리티
 * 주문번호, 발주번호, 송장번호는 절대 숫자로 처리하지 않는다.
 */

const SCIENTIFIC_NOTATION_RE = /^[+-]?(\d+\.?\d*|\.\d+)[eE][+-]?\d+$/

export function toSafeString(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') {
    const trimmed = value.trim()
    // 과학적 표기법 감지
    if (SCIENTIFIC_NOTATION_RE.test(trimmed)) {
      return `__SCIENTIFIC__:${trimmed}`
    }
    return trimmed
  }
  if (typeof value === 'number') {
    // 과학적 표기법으로 변환되는 큰 숫자 감지
    const str = String(value)
    if (SCIENTIFIC_NOTATION_RE.test(str)) {
      return `__SCIENTIFIC__:${str}`
    }
    // 정수형 숫자라면 그대로 문자열화
    if (Number.isInteger(value)) {
      return String(value)
    }
    return str
  }
  return String(value)
}

export function isScientificNotationRisk(value: string): boolean {
  return value.startsWith('__SCIENTIFIC__:') || SCIENTIFIC_NOTATION_RE.test(value)
}

export function isValidOrderNo(value: string): boolean {
  if (!value || value.trim() === '') return false
  if (isScientificNotationRisk(value)) return false
  if (value.length < 10 || value.length > 30) return false
  return true
}

export function isValidInvoiceNo(value: string): boolean {
  if (!value || value.trim() === '') return false
  if (isScientificNotationRisk(value)) return false
  if (value.length < 8 || value.length > 25) return false
  return true
}

/** 투에버 정식 주문번호 형식 (숫자 19자리, 예: 0100012026070800002) */
export const TOEVER_ORDER_NO_LENGTH = 19
const TOEVER_ORDER_NO_RE = new RegExp(`^\\d{${TOEVER_ORDER_NO_LENGTH}}$`)

/**
 * 이지어드민 송장파일의 주문번호가 투에버 정식 주문번호 형식(숫자 19자리)인지 검사.
 * - "_gift" 등 접미사가 붙은 사은품용 임시 주문번호
 * - 길이가 다른 사내 관리용 코드
 * 이런 값들은 투에버 실제 주문과 매칭될 수 없으므로 송장 import 대상에서 제외한다.
 */
export function isStandardToeverOrderNo(value: string): boolean {
  if (!value) return false
  if (isScientificNotationRisk(value)) return false
  return TOEVER_ORDER_NO_RE.test(value)
}

// computeOrderHash는 toeverOrderParser.ts에서 export됩니다.
// 이 파일에서는 중복 정의하지 않습니다.
