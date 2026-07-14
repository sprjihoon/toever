/**
 * 송장 import 시 비정상 주문번호(_gift 접미사, 길이 다름) 필터링 검증
 */
const path = require('path')
const fs = require('fs')
const os = require('os')

process.chdir(path.join(__dirname, '..'))

const { initDb, closeDb, getDb } = require('../dist-electron/electron/services/db/schema')
const { importEzadminInvoice } = require('../dist-electron/electron/services/toever/orchestrator')

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'toever-invfmt-'))
const TODAY = '2026-07-14'

initDb(tmpDir)
const db = getDb()

// 정상 주문 (19자리 숫자) — 매칭되어야 함
db.prepare(`
  INSERT INTO order_header (toever_order_no, order_date, receiver_name, receiver_phone, receiver_address, status, hash_snapshot)
  VALUES ('0100012026071300063', ?, '홍길동', '010', '서울', 'COLLECTED', 'h1')
`).run(TODAY)

// 실제로는 DB에 존재하지 않지만, 이지어드민 파일에는 짧은 코드나 _gift 접미사가 들어있는 상황을 시뮬레이션
// (이지어드민 확장주문검색 xls를 흉내낸 HTML 테이블 파일 생성)
const htmlRows = [
  ['0100012026071300063', '배송완료', '', '', '상품A', '', '1', '1', '2026-07-14', '111122223333', 'CJ대한통운', '', '서울', '홍길동', '010', '', '', ''],
  ['GIFT001_gift', '배송완료', '', '', '사은품', '', '1', '1', '2026-07-14', '222233334444', 'CJ대한통운', '', '서울', '김철수', '011', '', '', ''],
  ['12345', '배송완료', '', '', '짧은코드', '', '1', '1', '2026-07-14', '333344445555', 'CJ대한통운', '', '서울', '이영희', '012', '', '', ''],
]

const headers = ['주문번호', '상태', '상품코드', '바코드', '상품명', '옵션명', '주문수량', '상품수량', '송장입력일', '송장번호', '택배사', '수령자주소', '', '수령자이름', '수령자전화', '수령자휴대폰', '배송메모', '로케이션']

let html = `<html><head><meta charset="utf-8"></head><body><table><tr>${headers.map(h => `<td>${h}</td>`).join('')}</tr>`
for (const row of htmlRows) {
  html += `<tr>${row.map(c => `<td>${c}</td>`).join('')}</tr>`
}
html += '</table></body></html>'

const testFile = path.join(tmpDir, 'test_invoice.xls')
fs.writeFileSync(testFile, html, 'utf8')

let ok = true
const check = (name, pass) => { console.log(`${pass ? 'PASS' : 'FAIL'} | ${name}`); if (!pass) ok = false }

importEzadminInvoice({ filePath: testFile }).then(result => {
  console.log('result:', JSON.stringify(result, null, 2))
  check('matched === 1 (정상 주문만)', result.matched === 1)
  check('invalid_format === 2 (_gift + 짧은코드)', result.invalid_format === 2)
  check('orphan === 0 (형식불일치는 orphan 아님)', result.orphan === 0)

  const reviewCount = db.prepare("SELECT COUNT(*) AS c FROM manual_review_queue WHERE review_type='ORPHAN_INVOICE'").get().c
  check('manual_review_queue에 ORPHAN 등록 안 됨 (스팸 방지)', reviewCount === 0)

  const invoiceEventCount = db.prepare('SELECT COUNT(*) AS c FROM invoice_event').get().c
  check('invoice_event는 정상 주문 1건만', invoiceEventCount === 1)
}).catch(err => {
  console.error('FAIL | threw:', err)
  ok = false
}).finally(() => {
  closeDb()
  fs.rmSync(tmpDir, { recursive: true, force: true })
  process.exit(ok ? 0 : 1)
})
