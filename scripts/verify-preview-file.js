/**
 * 송장 업로드 파일 미리보기 기능 검증
 * - 미리보기 파일 생성 시 DB 상태(주문 상태, file_artifact) 변경이 없어야 함
 * - 실제 업로드 파일 생성 시에는 상태가 변경되어야 함 (기존 동작 보존 확인)
 */
const path = require('path')
const fs = require('fs')
const os = require('os')

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'toever-preview-'))
process.chdir(path.join(__dirname, '..'))

const { initDb, closeDb, getDb } = require('../dist-electron/electron/services/db/schema')
const {
  generateToeverInvoiceUploadPreview,
} = require('../dist-electron/electron/services/toever/orchestrator')
const { buildToeverInvoiceUploadFile } = require('../dist-electron/electron/services/exporter/toeverInvoiceBuilder')
const { getToeverInvoiceUploadRows } = require('../dist-electron/electron/services/db/repositories')

const TODAY = '2026-07-14'

initDb(tmpDir)
const db = getDb()

const o1 = db.prepare(`
  INSERT INTO order_header (
    toever_order_no, order_date, receiver_name, receiver_phone, receiver_address,
    status, hash_snapshot
  ) VALUES ('ORD-1001', ?, '홍길동', '010-1111-2222', '서울', 'INVOICE_IMPORTED', 'hashA')
`).run(TODAY)

db.prepare(`
  INSERT INTO invoice_event (order_id, source_type, invoice_no, status)
  VALUES (?, 'EZADMIN', 'INV-9001', 'MATCHED')
`).run(o1.lastInsertRowid)

let ok = true
const check = (name, pass) => {
  console.log(`${pass ? 'PASS' : 'FAIL'} | ${name}`)
  if (!pass) ok = false
}

try {
  // 1) 미리보기 생성 — 상태 변경 없어야 함
  const preview = generateToeverInvoiceUploadPreview()
  check('preview rowCount === 1', preview.rowCount === 1)
  check('preview row order_no', preview.rows[0]?.order_no === 'ORD-1001')
  check('preview row invoice_no', preview.rows[0]?.invoice_no === 'INV-9001')
  check('preview row recipient', preview.rows[0]?.recipient === '홍길동')
  check('preview file exists', fs.existsSync(preview.filePath))
  check('preview file in preview/ subfolder', preview.filePath.includes(`${path.sep}preview${path.sep}`))

  const orderAfterPreview = db.prepare('SELECT status FROM order_header WHERE id = ?').get(o1.lastInsertRowid)
  check('order status unchanged after preview', orderAfterPreview.status === 'INVOICE_IMPORTED')

  const artifactCountAfterPreview = db.prepare('SELECT COUNT(*) AS c FROM file_artifact').get().c
  check('no file_artifact row created by preview', artifactCountAfterPreview === 0)

  // 2) 실제 업로드 파일 생성 — 상태 변경되어야 함 (기존 동작 보존)
  const rows = getToeverInvoiceUploadRows()
  const built = buildToeverInvoiceUploadFile(rows)
  check('build file exists', fs.existsSync(built.filePath))

  const orderAfterBuild = db.prepare('SELECT status FROM order_header WHERE id = ?').get(o1.lastInsertRowid)
  check('order status changed to TOEVER_INVOICE_READY after real build', orderAfterBuild.status === 'TOEVER_INVOICE_READY')

  const artifactCountAfterBuild = db.prepare('SELECT COUNT(*) AS c FROM file_artifact').get().c
  check('file_artifact row created by real build', artifactCountAfterBuild === 1)
} catch (err) {
  console.error('FAIL | threw:', err.message)
  ok = false
} finally {
  closeDb()
  fs.rmSync(tmpDir, { recursive: true, force: true })
}

process.exit(ok ? 0 : 1)
