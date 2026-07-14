const path = require('path')
const fs = require('fs')
const os = require('os')
const XLSX = require('xlsx')

process.chdir(path.join(__dirname, '..'))

const { initDb, closeDb, getDb } = require('../dist-electron/electron/services/db/schema')
const { generateToeverInvoiceUploadPreview } = require('../dist-electron/electron/services/toever/orchestrator')

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'toever-xls-'))
const TODAY = '2026-07-14'

initDb(tmpDir)
const db = getDb()

db.prepare(`
  INSERT INTO order_header (toever_order_no, order_date, receiver_name, receiver_phone, receiver_address, status, hash_snapshot)
  VALUES ('0012345678', ?, '김철수', '010', '부산', 'INVOICE_IMPORTED', 'h1')
`).run(TODAY)
const o = db.prepare("SELECT id FROM order_header WHERE toever_order_no='0012345678'").get()
db.prepare(`INSERT INTO invoice_event (order_id, source_type, invoice_no, status) VALUES (?, 'EZADMIN', '00998877665', 'MATCHED')`).run(o.id)

let ok = true
const check = (name, pass) => { console.log(`${pass ? 'PASS' : 'FAIL'} | ${name}`); if (!pass) ok = false }

try {
  const preview = generateToeverInvoiceUploadPreview()
  const wb = XLSX.readFile(preview.filePath)
  check('Sheet1 exists', wb.SheetNames.includes('Sheet1'))
  check('택배사번호 sheet exists', wb.SheetNames.includes('택배사번호'))

  const sheet1 = wb.Sheets['Sheet1']
  const json = XLSX.utils.sheet_to_json(sheet1, { defval: '' })
  check('1 data row', json.length === 1)
  check('order_no preserved as text (leading zero)', String(json[0]['주문번호']) === '0012345678')
  check('invoice_no preserved as text (leading zero)', String(json[0]['송장번호']) === '00998877665')

  console.log('filePath:', preview.filePath)
} catch (err) {
  console.error('FAIL | threw:', err.message)
  ok = false
} finally {
  closeDb()
  fs.rmSync(tmpDir, { recursive: true, force: true })
}

process.exit(ok ? 0 : 1)
