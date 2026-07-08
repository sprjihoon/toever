import { getDb } from './schema'
import type {
  OrderHeader, OrderItem, FileArtifact, InvoiceEvent,
  EzadminExportBatch, ManualReviewItem, ToeverActionLog,
  BackupHistory, AppRun, OrderStatus, ManualReviewType,
  ArtifactType, RunType, RunStatus, CollectRound, ManualReviewStatus,
  DashboardStats, SearchOrdersParams, OrderDetail
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
): { id: number; isNew: boolean } {
  const db = getDb()
  const existing = db.prepare(
    'SELECT id, hash_snapshot FROM order_header WHERE toever_order_no = ?'
  ).get(data.toever_order_no) as { id: number; hash_snapshot: string } | undefined

  if (existing) {
    db.prepare(`
      UPDATE order_header
      SET toever_po_no = ?, last_seen_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
          hash_snapshot = ?, source_run_id = ?
      WHERE id = ?
    `).run(data.toever_po_no ?? null, data.hash_snapshot, data.source_run_id ?? null, existing.id)
    return { id: existing.id, isNew: false }
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

export function getOrdersForEzadminExport(business_date: string): OrderHeader[] {
  return getDb().prepare(`
    SELECT * FROM order_header
    WHERE status = 'NEW_SHIPMENT_TARGET'
    AND order_date = ?
    ORDER BY toever_order_no
  `).all(business_date) as OrderHeader[]
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
  const artifacts = db.prepare(`
    SELECT fa.* FROM file_artifact fa
    INNER JOIN toever_action_log tal ON tal.run_id = fa.run_id
    WHERE fa.artifact_type IN ('TOEVER_ORDER_RAW','TOEVER_ORDER_PDF','TOEVER_INVOICE_UPLOAD','SCREENSHOT')
    LIMIT 20
  `).all() as FileArtifact[]
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
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO order_item (order_id, line_no, product_name, option_name, quantity, ezadmin_product_code, barcode, line_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const insertMany = db.transaction((rows: typeof items) => {
    for (const row of rows) {
      stmt.run(order_id, row.line_no, row.product_name, row.option_name ?? null,
        row.quantity, row.ezadmin_product_code ?? null, row.barcode ?? null, row.line_hash)
    }
  })
  insertMany(items)
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
  getDb().prepare(`
    UPDATE ezadmin_export_batch
    SET status = 'CANCELLED', cancelled_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), cancelled_reason = ?
    WHERE id = ?
  `).run(reason, id)
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
