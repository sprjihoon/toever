/**
 * clearTodayOrderData FK 제약 통합 검증 (실제 SQLite)
 */
const path = require('path')
const fs = require('fs')
const os = require('os')

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'toever-clear-fk-'))
process.chdir(path.join(__dirname, '..'))

const { initDb, closeDb } = require('../dist-electron/electron/services/db/schema')
const { clearTodayOrderData } = require('../dist-electron/electron/services/db/repositories')

const TODAY = '2026-07-14'

initDb(tmpDir)
const db = require('../dist-electron/electron/services/db/schema').getDb()

// 시나리오: 오늘 수집 run + 보존 송장 주문이 source_run_id로 run 참조
const run = db.prepare(`
  INSERT INTO app_run (run_type, business_date, status, idempotency_key)
  VALUES ('COLLECT_ORDERS', ?, 'SUCCESS', 'test-collect-1')
`).run(TODAY)
const runId = run.lastInsertRowid

const preserved = db.prepare(`
  INSERT INTO order_header (
    toever_order_no, order_date, receiver_name, receiver_phone, receiver_address,
    status, latest_invoice_no, source_run_id, hash_snapshot
  ) VALUES ('ORD-PRESERVED', ?, '홍길동', '010', '서울', 'INVOICE_IMPORTED', 'INV-001', ?, 'hash1')
`).run(TODAY, runId)

db.prepare(`
  INSERT INTO invoice_event (order_id, source_type, invoice_no, status)
  VALUES (?, 'EZADMIN', 'INV-001', 'MATCHED')
`).run(preserved.lastInsertRowid)

db.prepare(`
  INSERT INTO order_header (
    toever_order_no, order_date, receiver_name, receiver_phone, receiver_address,
    status, source_run_id, hash_snapshot
  ) VALUES ('ORD-CLEAR-1', ?, '김철수', '011', '부산', 'NEW_SHIPMENT_TARGET', ?, 'hash2')
`).run(TODAY, runId)

db.prepare(`
  INSERT INTO order_header (
    toever_order_no, order_date, receiver_name, receiver_phone, receiver_address,
    status, source_run_id, hash_snapshot
  ) VALUES ('ORD-CLEAR-2', ?, '이영희', '012', '대구', 'COLLECTED', ?, 'hash3')
`).run(TODAY, runId)

db.prepare(`
  INSERT INTO file_artifact (artifact_type, original_filename, stored_path, sha256, size_bytes, run_id)
  VALUES ('EZADMIN_INVOICE', 'inv.xls', '/tmp/inv.xls', 'abc123', 100, ?)
`).run(runId)

db.prepare(`
  INSERT INTO manual_review_queue (review_type, severity, run_id, status)
  VALUES ('DUPLICATE', 'LOW', ?, 'OPEN')
`).run(runId)

// 실제 운영 장애 재현: toever_action_log가 run_id를 참조 (로그인 시도 로그 등)
db.prepare(`
  INSERT INTO toever_action_log (run_id, action_type, target_url, result_status)
  VALUES (?, 'LOGIN', 'https://example.com', 'SUCCESS')
`).run(runId)
db.prepare(`
  INSERT INTO toever_action_log (run_id, action_type, target_url, result_status)
  VALUES (?, 'COLLECT', 'https://example.com', 'SUCCESS')
`).run(runId)

let ok = true
try {
  const result = clearTodayOrderData(TODAY)
  const preservedRow = db.prepare(
    "SELECT * FROM order_header WHERE toever_order_no = 'ORD-PRESERVED'"
  ).get()
  const runStill = db.prepare('SELECT id FROM app_run WHERE id = ?').get(runId)

  const orphanActionLogs = db.prepare('SELECT COUNT(*) AS c FROM toever_action_log WHERE run_id = ?').get(runId).c

  const checks = [
    ['cleared 2', result.cleared === 2],
    ['preserved 1', result.preserved === 1],
    ['preserved order exists', !!preservedRow],
    ['invoice event kept', db.prepare('SELECT COUNT(*) AS c FROM invoice_event').get().c === 1],
    ['collect run deleted', !runStill],
    ['source_run_id nulled', preservedRow.source_run_id == null],
    ['toever_action_log detached', orphanActionLogs === 0],
  ]
  for (const [name, pass] of checks) {
    console.log(`${pass ? 'PASS' : 'FAIL'} | ${name}`)
    if (!pass) ok = false
  }
} catch (err) {
  console.error('FAIL | clearTodayOrderData threw:', err.message)
  ok = false
} finally {
  closeDb()
  fs.rmSync(tmpDir, { recursive: true, force: true })
}

process.exit(ok ? 0 : 1)
