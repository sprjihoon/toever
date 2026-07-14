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

/**
 * 수집 회차 식별자.
 * 'manual' 은 수동 실행(중복 idempotency 없음) 전용 예약어이며,
 * 그 외 값은 스케줄러에 등록된 각 시간대(ScheduleTimeEntry.id)를 가리키는 자유 문자열이다.
 */
export type CollectRound = string

/** 스케줄러에 등록된 자동 주문수집 시간대 (사용자가 추가/삭제/수정 가능) */
export interface ScheduleTimeEntry {
  id: string     // 안정적 식별자 (lock/idempotency key, DB collect_round 저장값)
  time: string   // 'HH:MM'
  label: string  // 화면에 표시할 이름 (예: "오전 수집", "1차 수집")
}

export type RunStatus = 'RUNNING' | 'SUCCESS' | 'FAILED' | 'PARTIAL'

export type RunType =
  | 'COLLECT_ORDERS'
  | 'EXPORT_EZADMIN'
  | 'IMPORT_INVOICE'
  | 'UPLOAD_TOEVER_INVOICE'
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

/** 투에버 송장 업로드 파일 1행 (같은 주문번호에 복수 송장 가능) */
export interface ToeverInvoiceUploadRow {
  order_id: number
  toever_order_no: string
  invoice_no: string
  receiver_name: string
  status: OrderStatus
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
  collect_by_round: { round: string; label: string; count: number }[]
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

// ============================================================
// 리포트
// ============================================================

export type ReportPeriod = 'day' | 'week' | 'month' | 'quarter' | 'half' | 'year'

// ── 위젯 타입 ──────────────────────────────────────────────
export type WidgetType =
  | 'summary_orders'
  | 'summary_shipped'
  | 'summary_quantity'
  | 'summary_unshipped'
  | 'summary_rate'
  | 'summary_cancelled'
  | 'summary_avg_lead_time'
  | 'summary_review_open'
  | 'trend_orders'
  | 'trend_shipped'
  | 'trend_quantity'
  | 'top_products'
  | 'by_option'
  | 'by_region'
  | 'by_courier'
  | 'by_status'
  | 'automation_runs'

export type WidgetSize = 'small' | 'medium' | 'large' | 'full'

export interface ReportWidgetConfig {
  id: string
  type: WidgetType
  label: string
  size: WidgetSize
  config?: { top_n?: number }
}

export interface ReportTemplate {
  id: number
  name: string
  description: string | null
  widgets: ReportWidgetConfig[]
  created_at: string
  updated_at: string
}

export interface ReportBuildParams {
  period: ReportPeriod
  date_from: string
  date_to: string
  widgets: ReportWidgetConfig[]
}

export interface WidgetResult {
  widget_id: string
  type: WidgetType
  data: unknown
  error?: string
}

export interface ReportParams {
  period: ReportPeriod
  date_from: string   // YYYY-MM-DD
  date_to: string     // YYYY-MM-DD
}

export interface ReportTrendRow {
  period_label: string
  orders: number
  shipped: number
  quantity: number
}

export interface ReportTopProduct {
  product_name: string
  option_name: string | null
  quantity: number
  order_count: number
}

export interface ReportRegionRow {
  region: string
  orders: number
  quantity: number
}

export interface ReportCourierRow {
  courier_name: string
  count: number
}

export interface ReportStatusRow {
  status: string
  count: number
}

export interface ReportData {
  summary: {
    total_orders: number
    total_shipped: number
    total_quantity: number
    distinct_products: number
  }
  trend: ReportTrendRow[]
  top_products: ReportTopProduct[]
  by_region: ReportRegionRow[]
  by_courier: ReportCourierRow[]
  by_status: ReportStatusRow[]
}

// ============================================================
// 휴일 (스케줄러 자동수집/백업 스킵용)
// ============================================================

export type HolidaySource = 'PUBLIC_SEED' | 'PUBLIC_API' | 'COMPANY'

export interface AppHoliday {
  id: number
  date: string    // YYYY-MM-DD
  name: string
  source: HolidaySource
  created_at: string
}

export interface AppSettings {
  toever_id: string
  toever_password: string
  storage_base_path: string
  backup_path: string
  scheduler_enabled: boolean
  collect_schedule: ScheduleTimeEntry[]
  /** 투에버 송장 자동 업로드 시각 (HH:MM). 빈 문자열이면 자동 업로드 비활성화(수동 버튼만 사용) */
  invoice_upload_time: string
  close_backup_time: string
  public_data_api_key: string
}
