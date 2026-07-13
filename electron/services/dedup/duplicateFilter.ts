/**
 * 중복 출고 방지 필터
 *
 * 최우선 원칙:
 *   투에버 주문번호(toever_order_no)가 이미 DB에 존재하면,
 *   상품/옵션/수량/주소/수취인/배송메시지가 변경되었더라도
 *   절대 신규 출고 대상(new_targets)에 포함하지 않는다.
 *
 * 처리 결과:
 * - new_targets        : DB에 없는 완전 신규 주문만 포함
 * - duplicates         : 이미 DB에 있는 주문 (동일 내용)
 * - changed_reviews    : 이미 DB에 있는 주문 (내용 변경 감지, 알림 목적)
 *                        → 상태 변경 없음, manual_review_queue 등록만 수행
 *
 * 상태 변경 금지:
 *   이 필터는 DB 주문 상태를 절대 변경하지 않는다.
 *   변경 감지(changed_reviews)는 알림/검토 목적이며 자동 재출고 목적이 아니다.
 */

import { getOrderByOrderNo, addManualReview, hasOpenReview } from '../db/repositories'
import { computeOrderHash } from '../parser/toeverOrderParser'
import type { ToeverOrderRow } from '../../../shared/types'

export interface FilterResult {
  /** DB에 없는 완전 신규 주문 (첫 번째 행) */
  new_targets: ToeverOrderRow[]
  /** 이미 DB에 있는 주문 — 동일 내용, 중복 스킵 */
  duplicates: string[]
  /** 이미 DB에 있는 주문 — 내용 변경 감지, manual_review 등록, 출고 차단 */
  changed_reviews: string[]
  errors: string[]
}

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
      // 완전 신규 — DB에 없는 경우만 신규 출고 대상
      new_targets.push(first)
      continue
    }

    // ── 이미 DB에 존재하는 주문번호 ──────────────────────────────
    // 어떤 상태든, 내용이 같든 다르든 절대 new_targets에 포함하지 않는다.

    const newHash = computeGroupHash(first, groupRows)

    if (existing.hash_snapshot === newHash) {
      // 동일 내용 → 중복 스킵 (상태 변경 없음)
      duplicates.push(orderNo)
      continue
    }

    // 내용 변경 감지 → 알림/검토 목적으로 manual_review 등록
    // 상태 변경 금지 — 자동 재출고 절대 불가
    changed_reviews.push(orderNo)
    if (!hasOpenReview(orderNo, 'ORDER_CHANGED_REVIEW')) {
      addManualReview({
        review_type:        'ORDER_CHANGED_REVIEW',
        severity:           'HIGH',
        toever_order_no:    orderNo,
        run_id,
        error_message:      `주문번호 동일, 내용 변경 감지 (기존 상태: ${existing.status}). ` +
                            '수취인/주소/상품/수량/배송메시지 중 하나가 변경됨',
        recommended_action: '기존 주문과 신규 수집 내용을 비교하여 수동 확인 후 처리',
      })
    }
    // 출고 차단: changed_reviews는 duplicates와 마찬가지로 new_targets에 포함하지 않음
  }

  return { new_targets, duplicates, changed_reviews, errors }
}
