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

export function computeOrderHash(data: {
  receiver_name: string
  receiver_phone: string
  receiver_address: string
  product_name: string
  option_name: string | null
  quantity: number
  delivery_message: string | null
}): string {
  const { createHash } = require('crypto')
  const str = [
    data.receiver_name,
    data.receiver_phone,
    data.receiver_address,
    data.product_name,
    data.option_name ?? '',
    String(data.quantity),
    data.delivery_message ?? '',
  ].join('|')
  return createHash('sha256').update(str, 'utf8').digest('hex').slice(0, 16)
}
