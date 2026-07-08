/**
 * 이지어드민 업로드 파일 생성
 *
 * 실제 양식 기준 (260708(1).xlsx):
 * - 시트명: Ordering_data
 * - 컬럼: 주문번호, 수령자명, 상품명, 옵션, 수량, 연락처, 주소, 배송메세지, 택배사, 송장번호
 *
 * 주의:
 * - 주문번호 셀은 반드시 텍스트 타입으로 강제 (앞자리 0 보존)
 * - 신규 출고 대상(NEW_SHIPMENT_TARGET)만 포함
 * - 같은 주문번호가 여러 상품 라인일 경우 각 상품 라인을 별도 행으로 출력
 */

import XLSX from 'xlsx'
import path from 'path'
import fs from 'fs'
import { DIRS, buildDatePrefix, sha256OfBuffer } from '../storage'
import { getDb } from '../db/schema'
import { saveFileArtifact, createEzadminBatch, updateOrderStatus } from '../db/repositories'
import type { OrderHeader, OrderItem, CollectRound } from '../../../shared/types'

interface EzadminRow {
  주문번호:   string
  수령자명:   string
  상품명:     string
  옵션:       string
  수량:       number
  연락처:     string
  주소:       string
  배송메세지: string
  택배사:     string
  송장번호:   string
}

const SHEET_NAME = 'Ordering_data'

export function buildEzadminUploadFile(
  orders: { header: OrderHeader; items: OrderItem[] }[],
  businessDate: string,
  run_id?: number,
  round?: CollectRound
): { filePath: string; batchId: number; rowCount: number } {
  if (orders.length === 0) throw new Error('출고 대상 주문이 없습니다.')

  const dataRows: EzadminRow[] = []

  for (const { header, items } of orders) {
    // 주문번호는 반드시 string (앞자리 0 보존)
    const orderNo = String(header.toever_order_no)

    if (items.length === 0) {
      // 상품 라인이 없으면 헤더 정보만으로 1행 생성
      dataRows.push(makeRow(orderNo, header, '', '', 1))
    } else {
      for (const item of items) {
        dataRows.push(makeRow(orderNo, header, item.product_name, item.option_name ?? '', item.quantity))
      }
    }
  }

  // 워크북 생성
  const wb = XLSX.utils.book_new()

  // 헤더 순서 고정
  const headers: Array<keyof EzadminRow> = [
    '주문번호', '수령자명', '상품명', '옵션', '수량',
    '연락처', '주소', '배송메세지', '택배사', '송장번호',
  ]

  const ws = XLSX.utils.json_to_sheet(dataRows, { header: headers })

  // 주문번호 열(A열) 텍스트 타입 강제
  forceColumnAsText(ws, 0, dataRows.length)

  XLSX.utils.book_append_sheet(wb, ws, SHEET_NAME)

  const dir = DIRS.generatedEzadminUpload()
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

  const datePrefix = buildDatePrefix(businessDate)
  const roundLabel = round ?? 'manual'

  // 같은 날짜 + round로 기존 파일 수를 세어 순번 결정 (1차, 2차, ...)
  const existing = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter(f => f.startsWith(`${datePrefix}_ezadmin_upload_${roundLabel}_`))
    : []
  const seq = existing.length + 1

  const filename = `${datePrefix}_ezadmin_upload_${roundLabel}_${seq}차.xlsx`
  const filePath = path.join(dir, filename)

  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' }) as Buffer
  fs.writeFileSync(filePath, buf)

  const sha256 = sha256OfBuffer(buf)

  // DB 작업 전체를 단일 트랜잭션으로 묶어 파일 생성-배치-상태변경을 원자적으로 처리
  const db = getDb()
  const { batchId } = db.transaction(() => {
    const artifact = saveFileArtifact({
      artifact_type: 'EZADMIN_UPLOAD',
      original_filename: filename,
      stored_path: filePath,
      sha256,
      size_bytes: buf.length,
      run_id: run_id ?? null,
    })
    // order_count는 고유 주문건수(헤더 수), row_count는 상품 라인 수
    const batch = createEzadminBatch(orders.length, artifact.id)
    for (const { header } of orders) {
      // status 변경과 동시에 ezadmin_batch_id 연결 (배치 취소 추적에 필수)
      db.prepare('UPDATE order_header SET status = ?, ezadmin_batch_id = ? WHERE id = ?')
        .run('EXPORTED_TO_EZADMIN', batch.id, header.id)
    }
    return { batchId: batch.id }
  })()

  return { filePath, batchId, rowCount: dataRows.length }
}

function makeRow(
  orderNo: string,
  header: OrderHeader,
  productName: string,
  optionName: string,
  quantity: number
): EzadminRow {
  return {
    주문번호:   orderNo,
    수령자명:   header.receiver_name,
    상품명:     productName,
    옵션:       optionName,
    수량:       quantity,
    연락처:     header.receiver_phone,
    주소:       header.receiver_address,
    배송메세지: header.delivery_message ?? '',
    택배사:     '',    // 이지어드민이 처리
    송장번호:   '',    // 이지어드민이 채움
  }
}

/**
 * 워크시트의 특정 열을 텍스트 타입으로 강제한다.
 * 주문번호 열에 적용하여 앞자리 0이 사라지지 않게 한다.
 */
function forceColumnAsText(ws: XLSX.WorkSheet, colIndex: number, dataCount: number): void {
  const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1')
  for (let R = range.s.r + 1; R <= range.s.r + dataCount; R++) {
    const addr = XLSX.utils.encode_cell({ r: R, c: colIndex })
    if (ws[addr]) {
      ws[addr].t = 's'
      ws[addr].z = '@'  // 텍스트 서식
    }
  }
}
