/**
 * 중복 출고 방지 필터
 *
 * 같은 주문번호가 여러 상품 라인(행)으로 들어올 수 있으므로
 * 먼저 order_no 기준으로 그룹화한 뒤 처리한다.
 *
 * 처리 결과:
 * - NEW_SHIPMENT_TARGET : DB에 없는 신규 주문
 * - DUPLICATE_SKIPPED   : 이미 처리 중인 동일 내용 주문
 * - ORDER_CHANGED_REVIEW: 같은 주문번호인데 내용 변경 감지 → 수동검토
 */

import { getOrderByOrderNo, updateOrderStatus, addManualReview } from '../db/repositories'
import { computeOrderHash } from '../parser/toeverOrderParser'
import type { ToeverOrderRow } from '../../../shared/types'

export interface FilterResult {
  /** 고유 주문번호 기준, 신규 출고 대상인 첫 번째 행들 */
  new_targets: ToeverOrderRow[]
  /** 중복으로 건너뛸 고유 주문번호 목록 */
  duplicates: string[]
  /** 내용 변경 감지된 고유 주문번호 목록 */
  changed_reviews: string[]
  errors: string[]
}

/** 이 상태의 주문은 이미 출고 프로세스에 있으므로 재처리 금지 */
const SKIP_STATUSES = new Set([
  'EXPORTED_TO_EZADMIN',
  'INVOICE_IMPORTED',
  'TOEVER_INVOICE_READY',
  'TOEVER_INVOICE_UPLOADED',
  'STOREOUT_INSTRUCTED',
  'CANCELLED',
  'RETURN_REQUESTED',
  'ON_HOLD',
  'MANUAL_REVIEW',
])

/** 이 상태이면 중복(같은 내용)으로 판단 */
const DUPLICATE_STATUSES = new Set([
  'COLLECTED',
  'NEW_SHIPMENT_TARGET',
  'DUPLICATE_SKIPPED',
  'ORDER_CHANGED_REVIEW',
  'ERROR',
])

/**
 * 여러 상품 라인을 포함한 주문 그룹의 해시를 계산한다.
 * orchestrator.ts의 해시 계산과 반드시 동일해야 한다.
 */
function computeGroupHash(first: ToeverOrderRow, allRows: ToeverOrderRow[]): string {
  return computeOrderHash({
    receiver_name:    first.receiver_name,
    receiver_phone:   first.receiver_phone,
    receiver_address: first.receiver_address,
    product_name:     allRows.map(r => `${r.product_name}/${r.option_name ?? ''}/${r.quantity}`).join('|'),
    option_name:      null,
    quantity:         allRows.reduce((s, r) => s + r.quantity, 0),
    delivery_message: first.delivery_message,
  })
}

export function filterNewShipmentTargets(
  rows: ToeverOrderRow[],
  run_id?: number
): FilterResult {
  const new_targets: ToeverOrderRow[] = []
  const duplicates: string[] = []
  const changed_reviews: string[] = []
  const errors: string[] = []

  // 주문번호 기준으로 그룹화
  const groups = new Map<string, ToeverOrderRow[]>()
  for (const row of rows) {
    const group = groups.get(row.toever_order_no) ?? []
    group.push(row)
    groups.set(row.toever_order_no, group)
  }

  for (const [orderNo, groupRows] of groups.entries()) {
    const first = groupRows[0]
    const existing = getOrderByOrderNo(orderNo)

    if (!existing) {
      // 완전 신규
      new_targets.push(first)
      continue
    }

    if (SKIP_STATUSES.has(existing.status)) {
      // 이미 출고 진행 중 → 건너뜀
      duplicates.push(orderNo)
      continue
    }

    if (DUPLICATE_STATUSES.has(existing.status)) {
      // 이전에 수집된 주문 → 내용 비교
      const newHash = computeGroupHash(first, groupRows)

      if (existing.hash_snapshot === newHash) {
        // 동일 내용 → 중복
        duplicates.push(orderNo)
      } else {
        // 내용 변경 감지 → 수동검토
        changed_reviews.push(orderNo)
        updateOrderStatus(existing.id, 'ORDER_CHANGED_REVIEW')
        addManualReview({
          review_type:        'ORDER_CHANGED_REVIEW',
          severity:           'HIGH',
          toever_order_no:    orderNo,
          run_id,
          error_message:      '같은 주문번호인데 수취인/주소/상품/수량 중 하나가 변경됨',
          recommended_action: '기존 주문과 신규 수집 주문을 비교하여 수동 확인 필요',
        })
      }
      continue
    }

    // 알 수 없는 상태 → 신규로 처리
    new_targets.push(first)
  }

  return { new_targets, duplicates, changed_reviews, errors }
}
