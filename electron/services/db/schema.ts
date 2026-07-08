import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (!db) throw new Error('DB가 초기화되지 않았습니다.')
  return db
}

export function initDb(storagePath: string): Database.Database {
  const dbDir = path.join(storagePath, 'database')
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true })

  const dbPath = path.join(dbDir, 'toever_ops.db')
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')

  createTables(db)
  return db
}

function createTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_run (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      run_type         TEXT NOT NULL,
      business_date    TEXT NOT NULL,
      collect_round    TEXT,
      status           TEXT NOT NULL DEFAULT 'RUNNING',
      idempotency_key  TEXT NOT NULL UNIQUE,
      started_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      finished_at      TEXT,
      error_code       TEXT,
      error_message    TEXT,
      summary          TEXT
    );

    CREATE TABLE IF NOT EXISTS order_header (
      id                      INTEGER PRIMARY KEY AUTOINCREMENT,
      toever_order_no         TEXT NOT NULL UNIQUE,
      toever_po_no            TEXT,
      order_date              TEXT NOT NULL,
      receiver_name           TEXT NOT NULL,
      receiver_phone          TEXT NOT NULL,
      receiver_address        TEXT NOT NULL,
      delivery_message        TEXT,
      status                  TEXT NOT NULL DEFAULT 'COLLECTED',
      latest_invoice_no       TEXT,
      latest_courier_name     TEXT,
      latest_invoice_input_at TEXT,
      first_seen_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      last_seen_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      ezadmin_batch_id        INTEGER,
      source_run_id           INTEGER,
      hash_snapshot           TEXT NOT NULL,
      FOREIGN KEY (ezadmin_batch_id) REFERENCES ezadmin_export_batch(id),
      FOREIGN KEY (source_run_id) REFERENCES app_run(id)
    );

    CREATE INDEX IF NOT EXISTS idx_order_header_status ON order_header(status);
    CREATE INDEX IF NOT EXISTS idx_order_header_order_date ON order_header(order_date);

    CREATE TABLE IF NOT EXISTS order_item (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id              INTEGER NOT NULL,
      line_no               INTEGER NOT NULL,
      product_name          TEXT NOT NULL,
      option_name           TEXT,
      quantity              INTEGER NOT NULL,
      ezadmin_product_code  TEXT,
      barcode               TEXT,
      line_hash             TEXT NOT NULL,
      FOREIGN KEY (order_id) REFERENCES order_header(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS file_artifact (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      artifact_type     TEXT NOT NULL,
      original_filename TEXT NOT NULL,
      stored_path       TEXT NOT NULL,
      sha256            TEXT NOT NULL,
      size_bytes        INTEGER NOT NULL DEFAULT 0,
      created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      run_id            INTEGER,
      FOREIGN KEY (run_id) REFERENCES app_run(id)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_file_artifact_sha256 ON file_artifact(sha256);

    CREATE TABLE IF NOT EXISTS invoice_event (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id         INTEGER NOT NULL,
      source_type      TEXT NOT NULL,
      invoice_no       TEXT NOT NULL,
      courier_name     TEXT,
      invoice_input_at TEXT,
      status           TEXT NOT NULL,
      message          TEXT,
      created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      FOREIGN KEY (order_id) REFERENCES order_header(id)
    );

    CREATE TABLE IF NOT EXISTS ezadmin_export_batch (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_no         TEXT NOT NULL UNIQUE,
      file_id          INTEGER,
      status           TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      cancelled_at     TEXT,
      cancelled_reason TEXT,
      order_count      INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (file_id) REFERENCES file_artifact(id)
    );

    CREATE TABLE IF NOT EXISTS manual_review_queue (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      review_type        TEXT NOT NULL,
      severity           TEXT NOT NULL DEFAULT 'MEDIUM',
      detected_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      toever_order_no    TEXT,
      toever_po_no       TEXT,
      related_file_path  TEXT,
      run_id             INTEGER,
      error_message      TEXT,
      recommended_action TEXT,
      memo               TEXT,
      status             TEXT NOT NULL DEFAULT 'OPEN',
      resolved_by        TEXT,
      resolved_at        TEXT,
      FOREIGN KEY (run_id) REFERENCES app_run(id)
    );

    CREATE INDEX IF NOT EXISTS idx_manual_review_status ON manual_review_queue(status);

    CREATE TABLE IF NOT EXISTS toever_action_log (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id          INTEGER,
      action_type     TEXT NOT NULL,
      target_url      TEXT,
      payload         TEXT,
      result_status   TEXT NOT NULL,
      result_message  TEXT,
      screenshot_path TEXT,
      executed_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      FOREIGN KEY (run_id) REFERENCES app_run(id)
    );

    CREATE TABLE IF NOT EXISTS report_template (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL UNIQUE,
      description TEXT,
      widgets     TEXT NOT NULL DEFAULT '[]',
      created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TABLE IF NOT EXISTS backup_history (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      backup_type   TEXT NOT NULL DEFAULT 'AUTO',
      source_path   TEXT NOT NULL,
      dest_path     TEXT NOT NULL,
      status        TEXT NOT NULL,
      error_message TEXT,
      size_bytes    INTEGER,
      file_count    INTEGER,
      started_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      finished_at   TEXT
    );

    CREATE TABLE IF NOT EXISTS manual_shipment (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      manual_date      TEXT NOT NULL,
      receiver_name    TEXT NOT NULL,
      receiver_phone   TEXT,
      receiver_address TEXT,
      product_name     TEXT NOT NULL,
      option_name      TEXT,
      quantity         INTEGER NOT NULL DEFAULT 1,
      invoice_no       TEXT,
      courier_name     TEXT,
      reason           TEXT,
      memo             TEXT,
      toever_order_no  TEXT,
      created_by       TEXT,
      created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE INDEX IF NOT EXISTS idx_manual_shipment_date ON manual_shipment(manual_date);
  `)
}

export function closeDb(): void {
  if (db) {
    db.close()
    db = null
  }
}
