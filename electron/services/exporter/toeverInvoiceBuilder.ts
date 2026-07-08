/**
 * 투에버 송장 업로드 파일 생성
 *
 * 실제 양식 기준 (upload_form.xls):
 * - 파일 형식: BIFF xls (실제 Excel 바이너리)
 * - Sheet1: 주문번호 | 송장번호 (2컬럼)
 * - Sheet "택배사번호": 참고용 택배사 코드표 (업로드에 사용하지 않음)
 *
 * 처리 규칙:
 * - 두 컬럼 모두 텍스트 서식 강제 (앞자리 0 / 긴 숫자 보존)
 * - 같은 주문번호는 1줄만 생성
 * - INVOICE_IMPORTED 또는 TOEVER_INVOICE_READY 상태 + 송장번호 있는 주문만 포함
 */

import XLSX from 'xlsx'
import path from 'path'
import fs from 'fs'
import { DIRS, buildDatePrefix, sha256OfBuffer } from '../storage'
import { saveFileArtifact, updateOrderStatus } from '../db/repositories'
import type { OrderHeader } from '../../../shared/types'

export function buildToeverInvoiceUploadFile(
  orders: OrderHeader[],
  run_id?: number
): { filePath: string; rowCount: number } {
  if (orders.length === 0) throw new Error('송장 업로드 대상 주문이 없습니다.')

  // 중복 제거: 같은 주문번호는 1줄만
  const seen = new Set<string>()
  const rows: Array<{ 주문번호: string; 송장번호: string }> = []

  for (const order of orders) {
    if (seen.has(order.toever_order_no)) continue
    if (!order.latest_invoice_no) continue

    seen.add(order.toever_order_no)
    rows.push({
      주문번호: String(order.toever_order_no),   // TEXT 강제
      송장번호: String(order.latest_invoice_no),  // TEXT 강제
    })
  }

  if (rows.length === 0) throw new Error('송장번호가 있는 주문이 없습니다.')

  // 워크북 생성
  const wb = XLSX.utils.book_new()

  // Sheet1: 주문번호, 송장번호
  const wsData = XLSX.utils.json_to_sheet(rows, { header: ['주문번호', '송장번호'] })

  // 주문번호(A), 송장번호(B) 모두 텍스트 서식 강제
  const range = XLSX.utils.decode_range(wsData['!ref'] ?? 'A1')
  for (let R = range.s.r + 1; R <= range.s.r + rows.length; R++) {
    for (let C = 0; C <= 1; C++) {
      const addr = XLSX.utils.encode_cell({ r: R, c: C })
      if (wsData[addr]) {
        wsData[addr].t = 's'
        wsData[addr].z = '@'
      }
    }
  }
  XLSX.utils.book_append_sheet(wb, wsData, 'Sheet1')

  // 택배사번호 참고 시트 (upload_form.xls 원본 구조 유지)
  const courierData = [
    { 택배사번호: '45006', 택배사: '우체국택배(물류)' },
    { 택배사번호: '42003', 택배사: '우체국' },
    { 택배사번호: '04', 택배사: 'CJ대한통운' },
    { 택배사번호: '05', 택배사: '한진택배' },
    { 택배사번호: '06', 택배사: '롯데택배' },
    { 택배사번호: '08', 택배사: '로젠택배' },
  ]
  const wsCourier = XLSX.utils.json_to_sheet(courierData, { header: ['택배사번호', '택배사'] })
  XLSX.utils.book_append_sheet(wb, wsCourier, '택배사번호')

  // 파일 저장 (투에버 업로드용 xls = BIFF8)
  const dir = DIRS.generatedToeverInvoiceUpload()
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

  const datePrefix = buildDatePrefix()
  const ts = Date.now()
  const filename = `${datePrefix}_toever_invoice_upload_${ts}.xls`
  const filePath = path.join(dir, filename)

  const buf = XLSX.write(wb, { bookType: 'biff8', type: 'buffer' }) as Buffer
  fs.writeFileSync(filePath, buf)

  const sha256 = sha256OfBuffer(buf)
  saveFileArtifact({
    artifact_type: 'TOEVER_INVOICE_UPLOAD',
    original_filename: filename,
    stored_path: filePath,
    sha256,
    size_bytes: buf.length,
    run_id: run_id ?? null,
  })

  // 상태 TOEVER_INVOICE_READY로 변경
  for (const order of orders) {
    if (seen.has(order.toever_order_no)) {
      updateOrderStatus(order.id, 'TOEVER_INVOICE_READY')
    }
  }

  return { filePath, rowCount: rows.length }
}
