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
 * - 같은 주문번호에 복수 송장이 있으면 각각 별도 행 생성
 * - INVOICE_IMPORTED 또는 TOEVER_INVOICE_READY 상태 + 송장번호 있는 건만 포함
 */

import XLSX from 'xlsx'
import path from 'path'
import fs from 'fs'
import { DIRS, buildDatePrefix, sha256OfBuffer } from '../storage'
import { saveFileArtifact, updateOrderStatus } from '../db/repositories'
import type { ToeverInvoiceUploadRow } from '../../../shared/types'

function dedupeToeverInvoiceRows(rows: ToeverInvoiceUploadRow[]): {
  outputRows: Array<{ 주문번호: string; 송장번호: string }>
  orderIds: Set<number>
} {
  const seen = new Set<string>()
  const outputRows: Array<{ 주문번호: string; 송장번호: string }> = []
  const orderIds = new Set<number>()

  for (const row of rows) {
    if (!row.invoice_no) continue
    const key = `${row.toever_order_no}|${row.invoice_no}`
    if (seen.has(key)) continue

    seen.add(key)
    orderIds.add(row.order_id)
    outputRows.push({
      주문번호: String(row.toever_order_no),
      송장번호: String(row.invoice_no),
    })
  }

  return { outputRows, orderIds }
}

function buildToeverInvoiceWorkbook(outputRows: Array<{ 주문번호: string; 송장번호: string }>) {
  const wb = XLSX.utils.book_new()
  const wsData = XLSX.utils.json_to_sheet(outputRows, { header: ['주문번호', '송장번호'] })

  const range = XLSX.utils.decode_range(wsData['!ref'] ?? 'A1')
  for (let R = range.s.r + 1; R <= range.s.r + outputRows.length; R++) {
    for (let C = 0; C <= 1; C++) {
      const addr = XLSX.utils.encode_cell({ r: R, c: C })
      if (wsData[addr]) {
        wsData[addr].t = 's'
        wsData[addr].z = '@'
      }
    }
  }
  XLSX.utils.book_append_sheet(wb, wsData, 'Sheet1')

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

  return wb
}

/** 업로드 전 확인용 — DB/주문 상태 변경 없음 */
export function buildToeverInvoiceUploadPreviewFile(
  rows: ToeverInvoiceUploadRow[]
): { filePath: string; rowCount: number; rows: Array<{ order_no: string; invoice_no: string }> } {
  if (rows.length === 0) throw new Error('송장 업로드 대상 주문이 없습니다.')

  const { outputRows } = dedupeToeverInvoiceRows(rows)
  if (outputRows.length === 0) throw new Error('송장번호가 있는 주문이 없습니다.')

  const dir = path.join(DIRS.generatedToeverInvoiceUpload(), 'preview')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

  const datePrefix = buildDatePrefix()
  const filename = `${datePrefix}_toever_invoice_upload_preview_${Date.now()}.xls`
  const filePath = path.join(dir, filename)

  const buf = XLSX.write(buildToeverInvoiceWorkbook(outputRows), { bookType: 'biff8', type: 'buffer' }) as Buffer
  fs.writeFileSync(filePath, buf)

  return {
    filePath,
    rowCount: outputRows.length,
    rows: outputRows.map(r => ({ order_no: r.주문번호, invoice_no: r.송장번호 })),
  }
}

export function buildToeverInvoiceUploadFile(
  rows: ToeverInvoiceUploadRow[],
  run_id?: number
): { filePath: string; rowCount: number } {
  if (rows.length === 0) throw new Error('송장 업로드 대상 주문이 없습니다.')

  const { outputRows, orderIds } = dedupeToeverInvoiceRows(rows)
  if (outputRows.length === 0) throw new Error('송장번호가 있는 주문이 없습니다.')

  const dir = DIRS.generatedToeverInvoiceUpload()
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

  const datePrefix = buildDatePrefix()
  const filename = `${datePrefix}_toever_invoice_upload_${Date.now()}.xls`
  const filePath = path.join(dir, filename)

  const buf = XLSX.write(buildToeverInvoiceWorkbook(outputRows), { bookType: 'biff8', type: 'buffer' }) as Buffer
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

  for (const orderId of orderIds) {
    updateOrderStatus(orderId, 'TOEVER_INVOICE_READY')
  }

  return { filePath, rowCount: outputRows.length }
}
