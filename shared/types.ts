// ============================================================
// 공유 타입 정의 - Spring Toever Ops
// ============================================================

export type OrderStatus =
  | 'COLLECTED'
  | 'NEW_SHIPMENT_TARGET'
  | 'DUPLICATE_SKIPPED'
  | 'ORDER_CHANGED_REVIEW'
  | 'EXPORTED_TO_EZADMIN'
  | 'EZADMIN_BATCH_CANCELLED'
  | 'INVOICE_IMPORTED'
  | 'TOEVER_INVOICE_READY'
  | 'TOEVER_INVOICE_UPLOADED'
  | 'STOREOUT_INSTRUCTED'
  | 'MANUAL_REVIEW'
  | 'ERROR'
  | 'CANCELLED'
  | 'ON_HOLD'
  | 'RETURN_REQUESTED'

export type CollectRound = 'morning' | 'afternoon' | 'manual'

export type RunStatus = 'RUNNING' | 'SUCCESS' | 'FAILED' | 'PARTIAL'

export type RunType =
  | 'COLLECT_ORDERS'
  | 'EXPORT_EZADMIN'
  | 'IMPORT_INVOICE'
  | 'UPLOAD_TOEVER_INVOICE'
  | 'STOREOUT_INSTRUCT'
  | 'BACKUP'
  | 'REPORT'

export type ManualReviewType =
  | 'INVALID_ORDER_NO'
  | 'INVALID_PO_NO'
  | 'ORDER_CHANGED_REVIEW'
  | 'MULTI_INVOICE'
  | 'ORPHAN_INVOICE'
  | 'HEADER_MISMATCH'
  | 'UPLOAD_PARTIAL_FAIL'
  | 'TOKEN_MISSING'
  | 'STOREOUT_UNCLEAR'
  | 'SCIENTIFIC_NOTATION'
  | 'UNKNOWN'

export type ManualReviewStatus = 'OPEN' | 'ACK' | 'RESOLVED' | 'DISMISSED'

export type ArtifactType =
  | 'TOEVER_ORDER_RAW'
  | 'TOEVER_ORDER_PDF'
  | 'EZADMIN_UPLOAD'
  | 'EZADMIN_INVOICE_RAW'
  | 'TOEVER_INVOICE_UPLOAD'
  | 'REPORT'
  | 'SCREENSHOT'
  | 'LOG'

// ============================================================
// DB Row 타입
// ============================================================

export interface AppRun {
  id: number
  run_type: RunType
  business_date: string
  collect_round: CollectRound | null
  status: RunStatus
  idempotency_key: string
  started_at: string
  finished_at: string | null
  error_code: string | null
  error_message: string | null
  summary: string | null
}

export interface OrderHeader {
  id: number
  toever_order_no: string    // TEXT - 절대 숫자 변환 금지
  toever_po_no: string | null // TEXT - 절대 숫자 변환 금지
  order_date: string
  receiver_name: string
  receiver_phone: string
  receiver_address: string
  delivery_message: string | null
  status: OrderStatus
  latest_invoice_no: string | null   // TEXT - 절대 숫자 변환 금지
  latest_courier_name: string | null
  latest_invoice_input_at: string | null
  first_seen_at: string
  last_seen_at: string
  ezadmin_batch_id: number | null
  source_run_id: number | null
  hash_snapshot: string
}

export interface OrderItem {
  id: number
  order_id: number
  line_no: number
  product_name: string
  option_name: string | null
  quantity: number
  ezadmin_product_code: string | null
  barcode: string | null
  line_hash: string
}

export interface FileArtifact {
  id: number
  artifact_type: ArtifactType
  original_filename: string
  stored_path: string
  sha256: string
  size_bytes: number
  created_at: string
  run_id: number | null
}

export interface InvoiceEvent {
  id: number
  order_id: number
  source_type: string
  invoice_no: string    // TEXT
  courier_name: string | null
  invoice_input_at: string | null
  status: string
  message: string | null
  created_at: string
}

export interface EzadminExportBatch {
  id: number
  batch_no: string
  file_id: number | null
  status: 'ACTIVE' | 'CANCELLED'
  created_at: string
  cancelled_at: string | null
  cancelled_reason: string | null
  order_count: number
}

export interface ManualReviewItem {
  id: number
  review_type: ManualReviewType
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  detected_at: string
  toever_order_no: string | null
  toever_po_no: string | null
  related_file_path: string | null
  run_id: number | null
  error_message: string | null
  recommended_action: string | null
  memo: string | null
  status: ManualReviewStatus
  resolved_by: string | null
  resolved_at: string | null
}

export interface ToeverActionLog {
  id: number
  run_id: number | null
  action_type: string
  target_url: string | null
  payload: string | null
  result_status: string
  result_message: string | null
  screenshot_path: string | null
  executed_at: string
}

export interface BackupHistory {
  id: number
  backup_type: 'AUTO' | 'MANUAL'
  source_path: string
  dest_path: string
  status: 'SUCCESS' | 'FAILED' | 'SKIPPED'
  error_message: string | null
  size_bytes: number | null
  file_count: number | null
  started_at: string
  finished_at: string | null
}

export interface BackupProgress {
  phase: 'CHECK' | 'DB_SNAPSHOT' | 'FILES' | 'DONE' | 'ERROR'
  message: string
  files_copied?: number
  total_bytes?: number
  percent?: number
}

export interface BackupResult {
  success: boolean
  dest_path?: string
  file_count?: number
  size_bytes?: number
  started_at: string
  finished_at: string
  error?: string
  skipped?: boolean        // 외장 SSD 없음 등
  skip_reason?: string
}

export interface RunningAutomation {
  key: string
  label: string
}

export interface BackupStatusResult {
  last_backup: BackupHistory | null
  running_automations: RunningAutomation[]
  storage_ok: boolean
  backup_path_ok: boolean
}

// ============================================================
// 파싱 관련 타입
// ============================================================

export interface ToeverOrderRow {
  toever_order_no: string   // TEXT
  receiver_name: string
  product_name: string
  option_name: string | null
  quantity: number
  receiver_phone: string
  receiver_address: string
  delivery_message: string | null
  courier_name: string | null
  invoice_no: string | null  // TEXT
}

export interface EzadminInvoiceRow {
  order_no: string          // TEXT = 투에버 주문번호
  status?: string | null
  product_code?: string | null
  barcode?: string | null
  product_name?: string | null
  option_name?: string | null
  order_qty?: number | null
  product_qty?: number | null
  invoice_input_date?: string | null
  invoice_no?: string | null  // TEXT
  courier_name?: string | null
  receiver_address?: string | null
  receiver_name?: string | null
  receiver_phone?: string | null
  receiver_mobile?: string | null
  delivery_memo?: string | null
  location?: string | null
}

// ============================================================
// IPC 통신 타입
// ============================================================

export interface IpcResult<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

export interface DashboardStats {
  today: string
  total_collected: number
  morning_collected: number
  afternoon_collected: number
  new_shipment_targets: number
  duplicate_skipped: number
  order_changed_review: number
  exported_to_ezadmin: number
  invoice_imported: number
  toever_invoice_ready: number
  toever_invoice_uploaded: number
  storeout_instructed: number
  manual_review_open: number
  errors: number
  last_backup_at: string | null
}

export interface CollectOrdersParams {
  business_date: string
  round: CollectRound
  date_from: string
  date_to: string
}

export interface ImportInvoiceParams {
  file_path: string
}

export interface UploadToeverInvoiceParams {
  batch_date: string
}

export interface SearchOrdersParams {
  /** 통합 키워드: 주문번호 / 수령자명 / 연락처 */
  keyword?: string
  toever_order_no?: string
  toever_po_no?: string
  receiver_name?: string
  phone_last4?: string
  invoice_no?: string
  product_name?: string
  option_name?: string
  status?: OrderStatus
  date_from?: string
  date_to?: string
  /** 렌더러에서 page/page_size 사용 시 자동 변환 */
  page?: number
  page_size?: number
  limit?: number
  offset?: number
}

export interface OrderDetail {
  header: OrderHeader
  items: OrderItem[]
  invoiceEvents: InvoiceEvent[]
  artifacts: FileArtifact[]
  manualReviews: ManualReviewItem[]
}

export interface AppSettings {
  toever_id: string
  toever_password: string
  storage_base_path: string
  backup_path: string
  company_cd: string
  merchant_cd: string
  entr_no: string
  scheduler_enabled: boolean
  morning_collect_time: string
  afternoon_collect_time: string
  close_backup_time: string
}
