import { getDb } from './schema'
import type {
  OrderHeader, OrderItem, FileArtifact, InvoiceEvent,
  EzadminExportBatch, ManualReviewItem, ToeverActionLog,
  BackupHistory, AppRun, OrderStatus, ManualReviewType,
  ArtifactType, RunType, RunStatus, CollectRound, ManualReviewStatus,
  DashboardStats, SearchOrdersParams, OrderDetail,
  ReportParams, ReportData, ReportPeriod,
  ReportWidgetConfig, ReportTemplate, ReportBuildParams, WidgetResult, WidgetType,
  ManualShipment, ManualShipmentCreateParams, ManualShipmentSearchParams,
} from '../../../shared/types'

// ============================================================
// AppRun
// ============================================================

export function createRun(
  run_type: RunType,
  business_date: string,
  idempotency_key: string,
  collect_round?: CollectRound
): AppRun {
  const db = getDb()
  const stmt = db.prepare(`
    INSERT INTO app_run (run_type, business_date, collect_round, status, idempotency_key)
    VALUES (?, ?, ?, 'RUNNING', ?)
  `)
  const result = stmt.run(run_type, business_date, collect_round ?? null, idempotency_key)
  return getRunById(result.lastInsertRowid as number)!
}

export function getRunById(id: number): AppRun | null {
  return getDb().prepare('SELECT * FROM app_run WHERE id = ?').get(id) as AppRun | null
}

export function getRunByIdempotencyKey(key: string): AppRun | null {
  return getDb().prepare('SELECT * FROM app_run WHERE idempotency_key = ?').get(key) as AppRun | null
}

export function resetRunForRetry(id: number): void {
  getDb().prepare(`
    UPDATE app_run
    SET status = 'RUNNING', error_code = NULL, error_message = NULL,
        summary = NULL, finished_at = NULL,
        started_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE id = ?
  `).run(id)
}

export function updateRunStatus(
  id: number,
  status: RunStatus,
  summary?: string,
  error_code?: string,
  error_message?: string
): void {
  getDb().prepare(`
    UPDATE app_run
    SET status = ?, summary = ?, error_code = ?, error_message = ?,
        finished_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE id = ?
  `).run(status, summary ?? null, error_code ?? null, error_message ?? null, id)
}

// ============================================================
// OrderHeader
// ============================================================

export function upsertOrderHeader(
  data: Omit<OrderHeader, 'id' | 'first_seen_at' | 'last_seen_at'>
): { id: number; isNew: boolean; existingStatus?: OrderStatus } {
  const db = getDb()
  const existing = db.prepare(
    'SELECT id, hash_snapshot, status FROM order_header WHERE toever_order_no = ?'
  ).get(data.toever_order_no) as { id: number; hash_snapshot: string; status: OrderStatus } | undefined

  if (existing) {
    // 수신인 정보(주소·연락처 등)도 최신 값으로 갱신 — 배송지 변경 반영
    db.prepare(`
      UPDATE order_header
      SET toever_po_no = ?, last_seen_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
          hash_snapshot = ?, source_run_id = ?,
          receiver_name = ?, receiver_phone = ?,
          receiver_address = ?, delivery_message = ?
      WHERE id = ?
    `).run(
      data.toever_po_no ?? null,
      data.hash_snapshot,
      data.source_run_id ?? null,
      data.receiver_name,
      data.receiver_phone,
      data.receiver_address,
      data.delivery_message ?? null,
      existing.id
    )
    return { id: existing.id, isNew: false, existingStatus: existing.status }
  }

  const result = db.prepare(`
    INSERT INTO order_header (
      toever_order_no, toever_po_no, order_date, receiver_name, receiver_phone,
      receiver_address, delivery_message, status, source_run_id, hash_snapshot
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.toever_order_no,
    data.toever_po_no ?? null,
    data.order_date,
    data.receiver_name,
    data.receiver_phone,
    data.receiver_address,
    data.delivery_message ?? null,
    data.status,
    data.source_run_id ?? null,
    data.hash_snapshot
  )
  return { id: result.lastInsertRowid as number, isNew: true }
}

export function getOrderByOrderNo(toever_order_no: string): OrderHeader | null {
  return getDb().prepare(
    'SELECT * FROM order_header WHERE toever_order_no = ?'
  ).get(toever_order_no) as OrderHeader | null
}

export function updateOrderStatus(id: number, status: OrderStatus): void {
  getDb().prepare(
    'UPDATE order_header SET status = ? WHERE id = ?'
  ).run(status, id)
}

export function updateOrderStatusByOrderNo(toever_order_no: string, status: OrderStatus): void {
  getDb().prepare(
    'UPDATE order_header SET status = ? WHERE toever_order_no = ?'
  ).run(status, toever_order_no)
}

export function updateOrderInvoice(
  id: number,
  invoice_no: string,
  courier_name: string | null,
  invoice_input_at: string | null
): void {
  getDb().prepare(`
    UPDATE order_header
    SET latest_invoice_no = ?, latest_courier_name = ?, latest_invoice_input_at = ?,
        status = 'INVOICE_IMPORTED'
    WHERE id = ?
  `).run(invoice_no, courier_name ?? null, invoice_input_at ?? null, id)
}

export function getOrdersForEzadminExport(_business_date: string): OrderHeader[] {
  // 날짜 필터 없이 NEW_SHIPMENT_TARGET 전체 조회
  // (전날 미처리 주문도 포함하기 위해 날짜 제한 제거)
  return getDb().prepare(`
    SELECT * FROM order_header
    WHERE status = 'NEW_SHIPMENT_TARGET'
    ORDER BY order_date ASC, toever_order_no ASC
  `).all() as OrderHeader[]
}

export function getOrdersForToeverInvoiceUpload(): OrderHeader[] {
  return getDb().prepare(`
    SELECT * FROM order_header
    WHERE status IN ('INVOICE_IMPORTED', 'TOEVER_INVOICE_READY')
    AND latest_invoice_no IS NOT NULL
    AND latest_invoice_no != ''
    ORDER BY toever_order_no
  `).all() as OrderHeader[]
}

export function searchOrders(params: SearchOrdersParams): { orders: OrderHeader[]; total: number } {
  const db = getDb()
  const conditions: string[] = []
  const args: unknown[] = []

  // 통합 keyword: 주문번호 OR 수령자명 OR 연락처 모두 검색
  if (params.keyword) {
    const kw = `%${params.keyword}%`
    conditions.push("(toever_order_no LIKE ? OR receiver_name LIKE ? OR receiver_phone LIKE ? OR latest_invoice_no LIKE ?)")
    args.push(kw, kw, kw, kw)
  }
  if (params.toever_order_no) {
    conditions.push("toever_order_no LIKE ?")
    args.push(`%${params.toever_order_no}%`)
  }
  if (params.toever_po_no) {
    conditions.push("toever_po_no LIKE ?")
    args.push(`%${params.toever_po_no}%`)
  }
  if (params.receiver_name) {
    conditions.push("receiver_name LIKE ?")
    args.push(`%${params.receiver_name}%`)
  }
  if (params.phone_last4) {
    conditions.push("receiver_phone LIKE ?")
    args.push(`%${params.phone_last4}`)
  }
  if (params.invoice_no) {
    conditions.push("latest_invoice_no LIKE ?")
    args.push(`%${params.invoice_no}%`)
  }
  if (params.product_name) {
    conditions.push("id IN (SELECT order_id FROM order_item WHERE product_name LIKE ?)")
    args.push(`%${params.product_name}%`)
  }
  if (params.option_name) {
    conditions.push("id IN (SELECT order_id FROM order_item WHERE option_name LIKE ?)")
    args.push(`%${params.option_name}%`)
  }
  if (params.status) {
    conditions.push("status = ?")
    args.push(params.status)
  }
  if (params.date_from) {
    conditions.push("order_date >= ?")
    args.push(params.date_from)
  }
  if (params.date_to) {
    conditions.push("order_date <= ?")
    args.push(params.date_to)
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const total = (db.prepare(`SELECT COUNT(*) as cnt FROM order_header ${where}`).get(...args) as { cnt: number }).cnt

  // page/page_size 우선, fallback limit/offset
  const pageSize = params.page_size ?? params.limit ?? 20
  const page     = params.page ?? 1
  const limit    = pageSize
  const offset   = params.offset ?? (page - 1) * pageSize

  const orders = db.prepare(
    `SELECT * FROM order_header ${where} ORDER BY last_seen_at DESC LIMIT ? OFFSET ?`
  ).all(...args, limit, offset) as OrderHeader[]

  return { orders, total }
}

export function getOrderDetail(id: number): OrderDetail | null {
  const db = getDb()
  const header = db.prepare('SELECT * FROM order_header WHERE id = ?').get(id) as OrderHeader | null
  if (!header) return null

  const items = db.prepare('SELECT * FROM order_item WHERE order_id = ? ORDER BY line_no').all(id) as OrderItem[]
  const invoiceEvents = db.prepare('SELECT * FROM invoice_event WHERE order_id = ? ORDER BY created_at DESC').all(id) as InvoiceEvent[]
  // 해당 주문의 source_run_id로만 artifact 필터 (전체 조회 금지)
  const artifacts = header.source_run_id
    ? db.prepare(`
        SELECT * FROM file_artifact
        WHERE run_id = ?
          AND artifact_type IN ('TOEVER_ORDER_RAW','TOEVER_ORDER_PDF','TOEVER_INVOICE_UPLOAD','SCREENSHOT')
        ORDER BY created_at DESC
        LIMIT 20
      `).all(header.source_run_id) as FileArtifact[]
    : []
  const manualReviews = db.prepare(
    'SELECT * FROM manual_review_queue WHERE toever_order_no = ? ORDER BY detected_at DESC'
  ).all(header.toever_order_no) as ManualReviewItem[]

  return { header, items, invoiceEvents, artifacts, manualReviews }
}

// ============================================================
// OrderItem
// ============================================================

export function insertOrderItems(order_id: number, items: Omit<OrderItem, 'id' | 'order_id'>[]): void {
  const db = getDb()
  // 기존 아이템 삭제 후 전체 재삽입 (line_no UNIQUE 제약 없이도 중복 방지)
  const replaceAll = db.transaction((rows: typeof items) => {
    db.prepare('DELETE FROM order_item WHERE order_id = ?').run(order_id)
    const stmt = db.prepare(`
      INSERT INTO order_item (order_id, line_no, product_name, option_name, quantity, ezadmin_product_code, barcode, line_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (const row of rows) {
      stmt.run(order_id, row.line_no, row.product_name, row.option_name ?? null,
        row.quantity, row.ezadmin_product_code ?? null, row.barcode ?? null, row.line_hash)
    }
  })
  replaceAll(items)
}

export function getOrderItems(order_id: number): OrderItem[] {
  return getDb().prepare('SELECT * FROM order_item WHERE order_id = ? ORDER BY line_no').all(order_id) as OrderItem[]
}

// ============================================================
// FileArtifact
// ============================================================

export function saveFileArtifact(data: Omit<FileArtifact, 'id' | 'created_at'>): FileArtifact {
  const db = getDb()
  const existing = db.prepare('SELECT * FROM file_artifact WHERE sha256 = ?').get(data.sha256) as FileArtifact | null
  if (existing) return existing

  const result = db.prepare(`
    INSERT INTO file_artifact (artifact_type, original_filename, stored_path, sha256, size_bytes, run_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(data.artifact_type, data.original_filename, data.stored_path, data.sha256, data.size_bytes, data.run_id ?? null)
  return db.prepare('SELECT * FROM file_artifact WHERE id = ?').get(result.lastInsertRowid) as FileArtifact
}

// ============================================================
// EzadminExportBatch
// ============================================================

export function createEzadminBatch(order_count: number, file_id?: number): EzadminExportBatch {
  const db = getDb()
  const batch_no = `BATCH_${new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 17)}`
  const result = db.prepare(`
    INSERT INTO ezadmin_export_batch (batch_no, file_id, order_count)
    VALUES (?, ?, ?)
  `).run(batch_no, file_id ?? null, order_count)
  return db.prepare('SELECT * FROM ezadmin_export_batch WHERE id = ?').get(result.lastInsertRowid) as EzadminExportBatch
}

export function cancelEzadminBatch(id: number, reason: string): void {
  const db = getDb()
  // 배치 취소 + 연결된 주문 상태 복원을 원자적으로 처리
  db.transaction(() => {
    db.prepare(`
      UPDATE ezadmin_export_batch
      SET status = 'CANCELLED', cancelled_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), cancelled_reason = ?
      WHERE id = ?
    `).run(reason, id)
    // 해당 배치에 속한 주문을 EZADMIN_BATCH_CANCELLED로 변경 (재출고 대상으로 처리 가능)
    db.prepare(`
      UPDATE order_header
      SET status = 'EZADMIN_BATCH_CANCELLED'
      WHERE ezadmin_batch_id = ? AND status = 'EXPORTED_TO_EZADMIN'
    `).run(id)
  })()
}

export function getActiveBatches(): EzadminExportBatch[] {
  return getDb().prepare(
    "SELECT * FROM ezadmin_export_batch WHERE status = 'ACTIVE' ORDER BY created_at DESC"
  ).all() as EzadminExportBatch[]
}

// ============================================================
// ManualReviewQueue
// ============================================================

export function addManualReview(data: {
  review_type: ManualReviewType
  severity?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  toever_order_no?: string
  toever_po_no?: string
  related_file_path?: string
  run_id?: number
  error_message?: string
  recommended_action?: string
}): ManualReviewItem {
  const db = getDb()
  const result = db.prepare(`
    INSERT INTO manual_review_queue
      (review_type, severity, toever_order_no, toever_po_no, related_file_path, run_id, error_message, recommended_action)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.review_type,
    data.severity ?? 'MEDIUM',
    data.toever_order_no ?? null,
    data.toever_po_no ?? null,
    data.related_file_path ?? null,
    data.run_id ?? null,
    data.error_message ?? null,
    data.recommended_action ?? null
  )
  return db.prepare('SELECT * FROM manual_review_queue WHERE id = ?').get(result.lastInsertRowid) as ManualReviewItem
}

/**
 * 같은 주문번호 + review_type으로 이미 OPEN인 수동검토 항목이 있는지 확인 (중복 삽입 방지)
 */
export function hasOpenReview(toever_order_no: string, review_type: ManualReviewType): boolean {
  const row = getDb().prepare(
    "SELECT id FROM manual_review_queue WHERE toever_order_no = ? AND review_type = ? AND status = 'OPEN'"
  ).get(toever_order_no, review_type)
  return row !== undefined
}

export function updateManualReviewStatus(
  id: number,
  status: ManualReviewStatus,
  memo?: string,
  resolved_by?: string
): void {
  getDb().prepare(`
    UPDATE manual_review_queue
    SET status = ?, memo = ?, resolved_by = ?,
        resolved_at = CASE WHEN ? IN ('RESOLVED','DISMISSED') THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE resolved_at END
    WHERE id = ?
  `).run(status, memo ?? null, resolved_by ?? null, status, id)
}

export function getOpenManualReviews(): ManualReviewItem[] {
  return getDb().prepare(
    "SELECT * FROM manual_review_queue WHERE status = 'OPEN' ORDER BY detected_at DESC"
  ).all() as ManualReviewItem[]
}

export function getManualReviews(limit = 100, offset = 0): ManualReviewItem[] {
  return getDb().prepare(
    'SELECT * FROM manual_review_queue ORDER BY detected_at DESC LIMIT ? OFFSET ?'
  ).all(limit, offset) as ManualReviewItem[]
}

// ============================================================
// ToeverActionLog
// ============================================================

export function logToeverAction(data: {
  run_id?: number
  action_type: string
  target_url?: string
  payload?: string
  result_status: string
  result_message?: string
  screenshot_path?: string
}): void {
  getDb().prepare(`
    INSERT INTO toever_action_log (run_id, action_type, target_url, payload, result_status, result_message, screenshot_path)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.run_id ?? null,
    data.action_type,
    data.target_url ?? null,
    data.payload ?? null,
    data.result_status,
    data.result_message ?? null,
    data.screenshot_path ?? null
  )
}

// ============================================================
// BackupHistory
// ============================================================

export function saveBackupHistory(data: Omit<BackupHistory, 'id' | 'started_at'>): BackupHistory {
  const db = getDb()
  const result = db.prepare(`
    INSERT INTO backup_history (backup_type, source_path, dest_path, status, error_message, size_bytes, file_count, finished_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.backup_type,
    data.source_path,
    data.dest_path,
    data.status,
    data.error_message ?? null,
    data.size_bytes ?? null,
    data.file_count ?? null,
    data.finished_at ?? null
  )
  return db.prepare('SELECT * FROM backup_history WHERE id = ?').get(result.lastInsertRowid) as BackupHistory
}

export function getBackupHistoryList(limit = 20): BackupHistory[] {
  return getDb().prepare(
    'SELECT * FROM backup_history ORDER BY started_at DESC LIMIT ?'
  ).all(limit) as BackupHistory[]
}

// ============================================================
// Settings
// ============================================================

export function getSetting(key: string): string | null {
  const row = getDb().prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value ?? null
}

export function setSetting(key: string, value: string): void {
  getDb().prepare(
    'INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)'
  ).run(key, value)
}

export function getAllSettings(): Record<string, string> {
  const rows = getDb().prepare('SELECT key, value FROM app_settings').all() as { key: string; value: string }[]
  return Object.fromEntries(rows.map(r => [r.key, r.value]))
}

// ============================================================
// Dashboard
// ============================================================

export function getDashboardStats(today: string): DashboardStats {
  const db = getDb()

  const count = (sql: string, ...args: unknown[]): number => {
    const row = db.prepare(sql).get(...args) as { cnt: number }
    return row.cnt
  }

  const morning = count(
    "SELECT COUNT(*) as cnt FROM app_run WHERE run_type='COLLECT_ORDERS' AND business_date=? AND collect_round='morning' AND status='SUCCESS'",
    today
  )
  const afternoon = count(
    "SELECT COUNT(*) as cnt FROM app_run WHERE run_type='COLLECT_ORDERS' AND business_date=? AND collect_round='afternoon' AND status='SUCCESS'",
    today
  )

  const statusCount = (status: string) => count(
    'SELECT COUNT(*) as cnt FROM order_header WHERE order_date = ? AND status = ?',
    today, status
  )

  const lastBackup = db.prepare(
    "SELECT finished_at FROM backup_history WHERE status='SUCCESS' ORDER BY started_at DESC LIMIT 1"
  ).get() as { finished_at: string } | undefined

  return {
    today,
    total_collected: count('SELECT COUNT(*) as cnt FROM order_header WHERE order_date = ?', today),
    morning_collected: morning,
    afternoon_collected: afternoon,
    new_shipment_targets: statusCount('NEW_SHIPMENT_TARGET'),
    duplicate_skipped: statusCount('DUPLICATE_SKIPPED'),
    order_changed_review: statusCount('ORDER_CHANGED_REVIEW'),
    exported_to_ezadmin: statusCount('EXPORTED_TO_EZADMIN'),
    invoice_imported: statusCount('INVOICE_IMPORTED'),
    toever_invoice_ready: statusCount('TOEVER_INVOICE_READY'),
    toever_invoice_uploaded: statusCount('TOEVER_INVOICE_UPLOADED'),
    storeout_instructed: statusCount('STOREOUT_INSTRUCTED'),
    manual_review_open: count("SELECT COUNT(*) as cnt FROM manual_review_queue WHERE status = 'OPEN'"),
    errors: count(
      "SELECT COUNT(*) as cnt FROM order_header WHERE order_date = ? AND status = 'ERROR'",
      today
    ),
    last_backup_at: lastBackup?.finished_at ?? null,
  }
}

export function invoiceEventRepo() {
  return {
    insert(data: {
      order_id: number
      source_type: string
      invoice_no: string
      courier_name?: string | null
      invoice_input_at?: string | null
      status: string
      message?: string | null
    }): void {
      getDb().prepare(`
        INSERT INTO invoice_event (order_id, source_type, invoice_no, courier_name, invoice_input_at, status, message)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        data.order_id,
        data.source_type,
        data.invoice_no,
        data.courier_name ?? null,
        data.invoice_input_at ?? null,
        data.status,
        data.message ?? null
      )
    }
  }
}

// ============================================================
// 리포트
// ============================================================

function periodExpr(period: ReportPeriod, col = 'h.order_date'): string {
  switch (period) {
    case 'day':     return `substr(${col}, 1, 10)`
    case 'week':    return `strftime('%Y-W%W', ${col})`
    case 'month':   return `substr(${col}, 1, 7)`
    case 'quarter': return `substr(${col},1,4)||'-Q'||(((CAST(substr(${col},6,2)AS INTEGER)-1)/3)+1)`
    case 'half':    return `substr(${col},1,4)||CASE WHEN CAST(substr(${col},6,2)AS INTEGER)<=6 THEN '-H1' ELSE '-H2' END`
    case 'year':    return `substr(${col}, 1, 4)`
  }
}

export function getReportData(params: ReportParams): ReportData {
  const db = getDb()
  const { date_from, date_to, period } = params
  const pExpr = periodExpr(period)
  const mPExpr = periodExpr(period, 'ms.manual_date')

  // 요약 집계
  const summaryRow = db.prepare(`
    SELECT
      COUNT(DISTINCT h.id)                                                        AS total_orders,
      COUNT(DISTINCT CASE WHEN h.latest_invoice_no IS NOT NULL THEN h.id END)    AS total_shipped,
      COALESCE(SUM(i.quantity), 0)                                                AS total_quantity,
      COUNT(DISTINCT i.product_name)                                              AS distinct_products
    FROM order_header h
    LEFT JOIN order_item i ON i.order_id = h.id
    WHERE substr(h.order_date,1,10) BETWEEN ? AND ?
      AND h.status NOT IN ('CANCELLED','DUPLICATE_SKIPPED')
  `).get(date_from, date_to) as {
    total_orders: number; total_shipped: number
    total_quantity: number; distinct_products: number
  }

  // 수기건 요약
  const manualSummaryRow = db.prepare(`
    SELECT
      COUNT(*)              AS total_manual,
      COALESCE(SUM(quantity),0) AS total_manual_quantity
    FROM manual_shipment
    WHERE substr(manual_date,1,10) BETWEEN ? AND ?
  `).get(date_from, date_to) as { total_manual: number; total_manual_quantity: number }

  // 기간별 트렌드 (수기건 LEFT JOIN)
  const trendRaw = db.prepare(`
    SELECT
      ${pExpr}                                                                    AS period_label,
      COUNT(DISTINCT h.id)                                                        AS orders,
      COUNT(DISTINCT CASE WHEN h.latest_invoice_no IS NOT NULL THEN h.id END)    AS shipped,
      COALESCE(SUM(i.quantity), 0)                                                AS quantity
    FROM order_header h
    LEFT JOIN order_item i ON i.order_id = h.id
    WHERE substr(h.order_date,1,10) BETWEEN ? AND ?
      AND h.status NOT IN ('CANCELLED','DUPLICATE_SKIPPED')
    GROUP BY period_label
    ORDER BY period_label ASC
  `).all(date_from, date_to) as { period_label: string; orders: number; shipped: number; quantity: number }[]

  // 수기건 기간별 집계
  const manualTrendRaw = db.prepare(`
    SELECT
      ${mPExpr}                AS period_label,
      COUNT(*)                 AS count,
      COALESCE(SUM(quantity),0) AS quantity
    FROM manual_shipment ms
    WHERE substr(ms.manual_date,1,10) BETWEEN ? AND ?
    GROUP BY period_label
    ORDER BY period_label ASC
  `).all(date_from, date_to) as { period_label: string; count: number; quantity: number }[]

  // 트렌드에 수기건 merge
  const manualMap = new Map(manualTrendRaw.map(r => [r.period_label, r]))
  const trend = trendRaw.map(r => ({
    ...r,
    manual_count:    manualMap.get(r.period_label)?.count    ?? 0,
    manual_quantity: manualMap.get(r.period_label)?.quantity ?? 0,
  }))

  // 최다 출고 제품 TOP 20
  const top_products = db.prepare(`
    SELECT
      i.product_name,
      i.option_name,
      SUM(i.quantity)       AS quantity,
      COUNT(DISTINCT h.id)  AS order_count
    FROM order_item i
    JOIN order_header h ON h.id = i.order_id
    WHERE substr(h.order_date,1,10) BETWEEN ? AND ?
      AND h.status NOT IN ('CANCELLED','DUPLICATE_SKIPPED')
    GROUP BY i.product_name, i.option_name
    ORDER BY quantity DESC
    LIMIT 20
  `).all(date_from, date_to) as { product_name: string; option_name: string | null; quantity: number; order_count: number }[]

  // 지역별 (주소 첫 단어 = 시/도)
  const by_region = db.prepare(`
    SELECT
      CASE
        WHEN instr(h.receiver_address,' ')>0
        THEN substr(h.receiver_address,1,instr(h.receiver_address,' ')-1)
        ELSE h.receiver_address
      END                           AS region,
      COUNT(DISTINCT h.id)          AS orders,
      COALESCE(SUM(i.quantity),0)   AS quantity
    FROM order_header h
    LEFT JOIN order_item i ON i.order_id = h.id
    WHERE substr(h.order_date,1,10) BETWEEN ? AND ?
      AND h.status NOT IN ('CANCELLED','DUPLICATE_SKIPPED')
    GROUP BY region
    ORDER BY orders DESC
    LIMIT 30
  `).all(date_from, date_to) as { region: string; orders: number; quantity: number }[]

  // 택배사별
  const by_courier = db.prepare(`
    SELECT
      COALESCE(h.latest_courier_name,'미배송') AS courier_name,
      COUNT(*)                                  AS count
    FROM order_header h
    WHERE substr(h.order_date,1,10) BETWEEN ? AND ?
      AND h.status NOT IN ('CANCELLED','DUPLICATE_SKIPPED')
    GROUP BY courier_name
    ORDER BY count DESC
  `).all(date_from, date_to) as { courier_name: string; count: number }[]

  // 상태별
  const by_status = db.prepare(`
    SELECT status, COUNT(*) AS count
    FROM order_header
    WHERE substr(order_date,1,10) BETWEEN ? AND ?
    GROUP BY status
    ORDER BY count DESC
  `).all(date_from, date_to) as { status: string; count: number }[]

  return {
    summary: summaryRow,
    manual_summary: manualSummaryRow,
    trend,
    top_products,
    by_region,
    by_courier,
    by_status,
    manual_by_period: manualTrendRaw,
  }
}

// ============================================================
// ManualShipment (수기건)
// ============================================================

export function createManualShipment(data: ManualShipmentCreateParams): ManualShipment {
  const db = getDb()
  const result = db.prepare(`
    INSERT INTO manual_shipment
      (manual_date, receiver_name, receiver_phone, receiver_address,
       product_name, option_name, quantity, invoice_no, courier_name,
       reason, memo, toever_order_no, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.manual_date,
    data.receiver_name,
    data.receiver_phone ?? null,
    data.receiver_address ?? null,
    data.product_name,
    data.option_name ?? null,
    data.quantity,
    data.invoice_no ?? null,
    data.courier_name ?? null,
    data.reason ?? null,
    data.memo ?? null,
    data.toever_order_no ?? null,
    data.created_by ?? null,
  )
  return db.prepare('SELECT * FROM manual_shipment WHERE id = ?').get(result.lastInsertRowid) as ManualShipment
}

export function updateManualShipment(id: number, data: Partial<ManualShipmentCreateParams>): void {
  const db = getDb()
  const fields: string[] = []
  const values: unknown[] = []

  const map: Record<string, unknown> = {
    manual_date: data.manual_date, receiver_name: data.receiver_name,
    receiver_phone: data.receiver_phone, receiver_address: data.receiver_address,
    product_name: data.product_name, option_name: data.option_name,
    quantity: data.quantity, invoice_no: data.invoice_no,
    courier_name: data.courier_name, reason: data.reason,
    memo: data.memo, toever_order_no: data.toever_order_no,
    created_by: data.created_by,
  }

  for (const [k, v] of Object.entries(map)) {
    if (v !== undefined) {
      fields.push(`${k} = ?`)
      values.push(v ?? null)
    }
  }
  if (fields.length === 0) return
  fields.push(`updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`)
  values.push(id)
  db.prepare(`UPDATE manual_shipment SET ${fields.join(', ')} WHERE id = ?`).run(...values)
}

export function deleteManualShipment(id: number): void {
  getDb().prepare('DELETE FROM manual_shipment WHERE id = ?').run(id)
}

export function getManualShipmentList(params: ManualShipmentSearchParams): {
  items: ManualShipment[]
  total: number
} {
  const db = getDb()
  const conditions: string[] = []
  const args: unknown[] = []

  if (params.keyword) {
    const kw = `%${params.keyword}%`
    conditions.push('(receiver_name LIKE ? OR product_name LIKE ? OR invoice_no LIKE ? OR toever_order_no LIKE ?)')
    args.push(kw, kw, kw, kw)
  }
  if (params.date_from) { conditions.push('substr(manual_date,1,10) >= ?'); args.push(params.date_from) }
  if (params.date_to)   { conditions.push('substr(manual_date,1,10) <= ?'); args.push(params.date_to) }
  if (params.courier_name) { conditions.push('courier_name = ?'); args.push(params.courier_name) }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const total = (db.prepare(`SELECT COUNT(*) as cnt FROM manual_shipment ${where}`).get(...args) as { cnt: number }).cnt

  const pageSize = params.page_size ?? 50
  const page     = params.page ?? 1
  const offset   = (page - 1) * pageSize

  const items = db.prepare(
    `SELECT * FROM manual_shipment ${where} ORDER BY manual_date DESC, id DESC LIMIT ? OFFSET ?`
  ).all(...args, pageSize, offset) as ManualShipment[]

  return { items, total }
}

// ============================================================
// 보고서 템플릿 CRUD
// ============================================================

type TemplateRow = { id: number; name: string; description: string | null; widgets: string; created_at: string; updated_at: string }

function parseTemplate(row: TemplateRow): ReportTemplate {
  let widgets: ReportWidgetConfig[] = []
  try {
    widgets = JSON.parse(row.widgets) as ReportWidgetConfig[]
  } catch {
    widgets = []
  }
  return { ...row, widgets }
}

export function getReportTemplates(): ReportTemplate[] {
  const rows = getDb().prepare('SELECT * FROM report_template ORDER BY updated_at DESC').all() as TemplateRow[]
  return rows.map(parseTemplate)
}

export function getReportTemplateById(id: number): ReportTemplate | null {
  const row = getDb().prepare('SELECT * FROM report_template WHERE id = ?').get(id) as TemplateRow | null
  return row ? parseTemplate(row) : null
}

export function saveReportTemplate(
  name: string,
  description: string | null,
  widgets: ReportWidgetConfig[],
  existingId?: number
): ReportTemplate {
  const db = getDb()
  const json = JSON.stringify(widgets)
  if (existingId) {
    db.prepare(`
      UPDATE report_template
      SET name=?, description=?, widgets=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id=?
    `).run(name, description, json, existingId)
    return getReportTemplateById(existingId)!
  }
  const result = db.prepare(
    'INSERT INTO report_template (name, description, widgets) VALUES (?,?,?)'
  ).run(name, description, json)
  return getReportTemplateById(result.lastInsertRowid as number)!
}

export function deleteReportTemplate(id: number): void {
  getDb().prepare('DELETE FROM report_template WHERE id = ?').run(id)
}

// ============================================================
// 위젯 데이터 조회
// ============================================================

function periodExprH(period: ReportPeriod): string {
  switch (period) {
    case 'day':     return "substr(h.order_date, 1, 10)"
    case 'week':    return "strftime('%Y-W%W', h.order_date)"
    case 'month':   return "substr(h.order_date, 1, 7)"
    case 'quarter': return "substr(h.order_date,1,4)||'-Q'||(((CAST(substr(h.order_date,6,2)AS INTEGER)-1)/3)+1)"
    case 'half':    return "substr(h.order_date,1,4)||CASE WHEN CAST(substr(h.order_date,6,2)AS INTEGER)<=6 THEN '-H1' ELSE '-H2' END"
    case 'year':    return "substr(h.order_date, 1, 4)"
  }
}

export function getWidgetData(
  widget: ReportWidgetConfig,
  period: ReportPeriod,
  date_from: string,
  date_to: string
): WidgetResult {
  const db = getDb()
  const pe = periodExprH(period)
  try {
    let data: unknown
    const g = <T>(sql: string, ...args: unknown[]) =>
      (db.prepare(sql).get(...args) as T)
    const a = <T>(sql: string, ...args: unknown[]) =>
      (db.prepare(sql).all(...args) as T[])

    switch (widget.type as WidgetType) {
      case 'summary_orders':
        data = g<{v:number}>(`SELECT COUNT(*) AS v FROM order_header WHERE substr(order_date,1,10) BETWEEN ? AND ? AND status NOT IN ('CANCELLED','DUPLICATE_SKIPPED')`, date_from, date_to).v
        break
      case 'summary_shipped':
        data = g<{v:number}>(`SELECT COUNT(*) AS v FROM order_header WHERE substr(order_date,1,10) BETWEEN ? AND ? AND status NOT IN ('CANCELLED','DUPLICATE_SKIPPED') AND latest_invoice_no IS NOT NULL`, date_from, date_to).v
        break
      case 'summary_quantity':
        data = g<{v:number}>(`SELECT COALESCE(SUM(i.quantity),0) AS v FROM order_item i JOIN order_header h ON h.id=i.order_id WHERE substr(h.order_date,1,10) BETWEEN ? AND ? AND h.status NOT IN ('CANCELLED','DUPLICATE_SKIPPED')`, date_from, date_to).v
        break
      case 'summary_unshipped':
        data = g<{v:number}>(`SELECT COUNT(*) AS v FROM order_header WHERE substr(order_date,1,10) BETWEEN ? AND ? AND status NOT IN ('CANCELLED','DUPLICATE_SKIPPED','TOEVER_INVOICE_UPLOADED','STOREOUT_INSTRUCTED') AND latest_invoice_no IS NULL`, date_from, date_to).v
        break
      case 'summary_rate': {
        const r = g<{total:number;shipped:number}>(`SELECT COUNT(*) AS total, COUNT(CASE WHEN latest_invoice_no IS NOT NULL THEN 1 END) AS shipped FROM order_header WHERE substr(order_date,1,10) BETWEEN ? AND ? AND status NOT IN ('CANCELLED','DUPLICATE_SKIPPED')`, date_from, date_to)
        data = r.total > 0 ? Math.round((r.shipped / r.total) * 1000) / 10 : 0
        break
      }
      case 'summary_cancelled':
        data = g<{v:number}>(`SELECT COUNT(*) AS v FROM order_header WHERE substr(order_date,1,10) BETWEEN ? AND ? AND status='CANCELLED'`, date_from, date_to).v
        break
      case 'summary_avg_lead_time': {
        const r = g<{v:number|null}>(`SELECT ROUND(AVG(julianday(latest_invoice_input_at)-julianday(order_date)),1) AS v FROM order_header WHERE substr(order_date,1,10) BETWEEN ? AND ? AND latest_invoice_input_at IS NOT NULL AND status NOT IN ('CANCELLED','DUPLICATE_SKIPPED')`, date_from, date_to)
        data = r.v ?? 0
        break
      }
      case 'summary_review_open':
        data = g<{v:number}>(`SELECT COUNT(*) AS v FROM manual_review_queue WHERE status='OPEN'`).v
        break
      case 'trend_orders':
        data = a<{period_label:string;value:number}>(`SELECT ${pe} AS period_label, COUNT(*) AS value FROM order_header h WHERE substr(h.order_date,1,10) BETWEEN ? AND ? AND h.status NOT IN ('CANCELLED','DUPLICATE_SKIPPED') GROUP BY period_label ORDER BY period_label`, date_from, date_to)
        break
      case 'trend_shipped':
        data = a<{period_label:string;value:number}>(`SELECT ${pe} AS period_label, COUNT(*) AS value FROM order_header h WHERE substr(h.order_date,1,10) BETWEEN ? AND ? AND h.status NOT IN ('CANCELLED','DUPLICATE_SKIPPED') AND h.latest_invoice_no IS NOT NULL GROUP BY period_label ORDER BY period_label`, date_from, date_to)
        break
      case 'trend_quantity':
        data = a<{period_label:string;value:number}>(`SELECT ${pe} AS period_label, COALESCE(SUM(i.quantity),0) AS value FROM order_header h LEFT JOIN order_item i ON i.order_id=h.id WHERE substr(h.order_date,1,10) BETWEEN ? AND ? AND h.status NOT IN ('CANCELLED','DUPLICATE_SKIPPED') GROUP BY period_label ORDER BY period_label`, date_from, date_to)
        break
      case 'top_products': {
        const n = widget.config?.top_n ?? 10
        data = a<{product_name:string;option_name:string|null;quantity:number;order_count:number}>(`SELECT i.product_name, i.option_name, SUM(i.quantity) AS quantity, COUNT(DISTINCT h.id) AS order_count FROM order_item i JOIN order_header h ON h.id=i.order_id WHERE substr(h.order_date,1,10) BETWEEN ? AND ? AND h.status NOT IN ('CANCELLED','DUPLICATE_SKIPPED') GROUP BY i.product_name,i.option_name ORDER BY quantity DESC LIMIT ?`, date_from, date_to, n)
        break
      }
      case 'by_option':
        data = a<{product_name:string;option_name:string;quantity:number;order_count:number}>(`SELECT i.product_name, COALESCE(i.option_name,'(옵션없음)') AS option_name, SUM(i.quantity) AS quantity, COUNT(DISTINCT h.id) AS order_count FROM order_item i JOIN order_header h ON h.id=i.order_id WHERE substr(h.order_date,1,10) BETWEEN ? AND ? AND h.status NOT IN ('CANCELLED','DUPLICATE_SKIPPED') GROUP BY i.product_name,option_name ORDER BY quantity DESC LIMIT 30`, date_from, date_to)
        break
      case 'by_region':
        data = a<{region:string;orders:number;quantity:number}>(`SELECT CASE WHEN instr(h.receiver_address,' ')>0 THEN substr(h.receiver_address,1,instr(h.receiver_address,' ')-1) ELSE h.receiver_address END AS region, COUNT(DISTINCT h.id) AS orders, COALESCE(SUM(i.quantity),0) AS quantity FROM order_header h LEFT JOIN order_item i ON i.order_id=h.id WHERE substr(h.order_date,1,10) BETWEEN ? AND ? AND h.status NOT IN ('CANCELLED','DUPLICATE_SKIPPED') GROUP BY region ORDER BY orders DESC LIMIT 20`, date_from, date_to)
        break
      case 'by_courier':
        data = a<{courier_name:string;count:number}>(`SELECT COALESCE(latest_courier_name,'미배송') AS courier_name, COUNT(*) AS count FROM order_header WHERE substr(order_date,1,10) BETWEEN ? AND ? AND status NOT IN ('CANCELLED','DUPLICATE_SKIPPED') GROUP BY courier_name ORDER BY count DESC`, date_from, date_to)
        break
      case 'by_status':
        data = a<{status:string;count:number}>(`SELECT status, COUNT(*) AS count FROM order_header WHERE substr(order_date,1,10) BETWEEN ? AND ? GROUP BY status ORDER BY count DESC`, date_from, date_to)
        break
      case 'automation_runs':
        data = a<{run_type:string;total:number;success:number;failed:number;partial:number}>(`SELECT run_type, COUNT(*) AS total, COUNT(CASE WHEN status='SUCCESS' THEN 1 END) AS success, COUNT(CASE WHEN status='FAILED' THEN 1 END) AS failed, COUNT(CASE WHEN status='PARTIAL' THEN 1 END) AS partial FROM app_run WHERE substr(started_at,1,10) BETWEEN ? AND ? GROUP BY run_type ORDER BY total DESC`, date_from, date_to)
        break
      default:
        data = null
    }
    return { widget_id: widget.id, type: widget.type, data }
  } catch (e) {
    return { widget_id: widget.id, type: widget.type, data: null, error: String(e) }
  }
}

export function buildReport(params: ReportBuildParams): WidgetResult[] {
  return params.widgets.map(w => getWidgetData(w, params.period, params.date_from, params.date_to))
}
