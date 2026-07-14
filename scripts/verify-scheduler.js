/**
 * 스케줄러 관련 기능 통합 검증 (실제 SQLite, dist-electron 컴파일 결과 사용)
 * - 휴일 시드 데이터 반영 및 isHoliday 체크
 * - 회사 휴일 추가/삭제가 공휴일 시드와 독립적으로 동작하는지
 * - 수집 스케줄(add/remove) 마이그레이션 및 저장/조회
 * - 대시보드 통계의 회차별(collect_by_round) 동적 집계
 */
const path = require('path')
const fs = require('fs')
const os = require('os')

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'toever-scheduler-'))
process.chdir(path.join(__dirname, '..'))

const { initDb, closeDb } = require('../dist-electron/electron/services/db/schema')
const repo = require('../dist-electron/electron/services/db/repositories')
const { seedHardcodedHolidays } = require('../dist-electron/electron/services/holidaySync')

let pass = 0
let fail = 0
function check(name, cond) {
  if (cond) {
    pass++
    console.log(`  ✓ ${name}`)
  } else {
    fail++
    console.log(`  ✗ ${name}`)
  }
}

initDb(tmpDir)

// ── 1. 휴일 시드 ────────────────────────────────────────────
console.log('\n[1] 휴일 시드 데이터')
const seededCount = seedHardcodedHolidays()
check('시드 데이터가 1건 이상 반영됨', seededCount > 0)
check('2026-01-01(신정)이 휴일로 인식됨', repo.isHoliday('2026-01-01') === true)
check('2026-02-17(설날, 화요일)이 휴일로 인식됨', repo.isHoliday('2026-02-17') === true)
check('2026-07-13(평범한 월요일)은 휴일이 아님', repo.isHoliday('2026-07-13') === false)

// 재시드해도 중복 누적되지 않는지 (동일 date+source unique index)
const beforeCount = repo.getHolidays().length
seedHardcodedHolidays()
const afterCount = repo.getHolidays().length
check('시드를 두 번 실행해도 중복 행이 쌓이지 않음', beforeCount === afterCount)

// ── 2. 회사 휴일 추가/삭제 ──────────────────────────────────
console.log('\n[2] 회사 휴일 추가/삭제')
const companyHoliday = repo.addCompanyHoliday('2026-08-01', '창립기념일')
check('회사 휴일 추가 성공', companyHoliday.source === 'COMPANY' && companyHoliday.date === '2026-08-01')
check('회사 휴일 추가 후 isHoliday=true', repo.isHoliday('2026-08-01') === true)

// 같은 날짜에 공휴일 시드가 있어도 회사 휴일은 별도 행으로 공존해야 함
const overlapDate = '2026-01-01'
const beforeOverlap = repo.getHolidays(overlapDate, overlapDate).length
repo.addCompanyHoliday(overlapDate, '사내 임시휴무')
const afterOverlap = repo.getHolidays(overlapDate, overlapDate).length
check('공휴일과 같은 날짜에 회사 휴일을 추가해도 기존 공휴일 행은 유지됨(별도 행 추가)', afterOverlap === beforeOverlap + 1)

const companyRow = repo.getHolidays(overlapDate, overlapDate).find(h => h.source === 'COMPANY')
repo.deleteHoliday(companyRow.id)
const afterDelete = repo.getHolidays(overlapDate, overlapDate).length
check('회사 휴일 삭제 후 해당 날짜의 공휴일(PUBLIC_SEED)은 그대로 남음', afterDelete === beforeOverlap && repo.isHoliday(overlapDate) === true)

// ── 3. 수집 스케줄 (add/remove) ─────────────────────────────
console.log('\n[3] 수집 스케줄 시간 추가/제거')
const defaultSchedule = repo.getScheduleTimes()
check('최초 조회 시 기본 스케줄(오전/오후) 2건 마이그레이션됨', defaultSchedule.length === 2)
check('기본 스케줄이 설정에 영속됨', repo.getSetting('collect_schedule') !== null)

const customSchedule = [
  { id: 'morning', time: '09:00', label: '1차 수집' },
  { id: 'midday', time: '13:00', label: '2차 수집' },
  { id: 'evening', time: '18:00', label: '3차 수집' },
]
repo.setScheduleTimes(customSchedule)
const reloaded = repo.getScheduleTimes()
check('3개 시간대 추가 후 정확히 3건 조회됨', reloaded.length === 3)
check('추가한 시간대 값이 정확히 저장됨', reloaded[2].time === '18:00' && reloaded[2].label === '3차 수집')

repo.setScheduleTimes(customSchedule.filter(s => s.id !== 'midday'))
const afterRemove = repo.getScheduleTimes()
check('시간대 제거 후 2건으로 감소', afterRemove.length === 2)
check('제거한 시간대(midday)는 더 이상 존재하지 않음', !afterRemove.some(s => s.id === 'midday'))

// ── 4. 대시보드 회차별 집계 ─────────────────────────────────
console.log('\n[4] 대시보드 collect_by_round 동적 집계')
const db = require('../dist-electron/electron/services/db/schema').getDb()
const TODAY = '2026-07-13'
db.prepare(`INSERT INTO app_run (run_type, business_date, collect_round, status, idempotency_key) VALUES ('COLLECT_ORDERS', ?, 'morning', 'SUCCESS', 'k1')`).run(TODAY)
db.prepare(`INSERT INTO app_run (run_type, business_date, collect_round, status, idempotency_key) VALUES ('COLLECT_ORDERS', ?, 'evening', 'SUCCESS', 'k2')`).run(TODAY)
db.prepare(`INSERT INTO app_run (run_type, business_date, collect_round, status, idempotency_key) VALUES ('COLLECT_ORDERS', ?, 'manual', 'SUCCESS', 'k3')`).run(TODAY)

const stats = repo.getDashboardStats(TODAY)
check('collect_by_round에 morning/evening 2건만 집계됨 (manual 제외)', stats.collect_by_round.length === 2)
const morningEntry = stats.collect_by_round.find(r => r.round === 'morning')
check('morning 라운드 label이 현재 스케줄 설정과 매칭됨(1차 수집)', morningEntry && morningEntry.label === '1차 수집')
const eveningEntry = stats.collect_by_round.find(r => r.round === 'evening')
check('evening 라운드 label이 현재 스케줄 설정과 매칭됨(3차 수집)', eveningEntry && eveningEntry.label === '3차 수집')

closeDb()
try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch { /* ignore */ }

console.log(`\n결과: ${pass}건 통과, ${fail}건 실패`)
process.exit(fail > 0 ? 1 : 0)
