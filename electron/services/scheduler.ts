import cron from 'node-cron'
import { getAllSettings } from './db/repositories'
import { collectOrders, isLocked } from './toever/orchestrator'
import { runBackup } from './backup'
import { loadPassword } from './credential'
import { appendLog, logPath } from './storage'
import type { BrowserWindow } from 'electron'

let scheduledTasks: cron.ScheduledTask[] = []
let mainWindowRef: BrowserWindow | null = null

export function setMainWindow(win: BrowserWindow): void {
  mainWindowRef = win
}

function emit(event: string, data?: unknown): void {
  mainWindowRef?.webContents.send('automation:event', { event, data })
}

function log(message: string): void {
  const logFile = logPath('scheduler')
  appendLog(logFile, message)
  emit('progress', { step: message })
}

function timeToCron(time: string): string {
  // "10:30" → "30 10 * * 1-5"  (월~금)
  const [h, m] = time.split(':')
  return `${m ?? '0'} ${h ?? '0'} * * 1-5`
}

function isKoreanHoliday(_date: Date): boolean {
  // 공휴일 체크는 외부 API 또는 하드코딩 목록 활용
  // MVP에서는 빈 구현 (todo: 공휴일 목록 로딩)
  return false
}

function isWorkday(date: Date): boolean {
  const day = date.getDay() // 0=일, 6=토
  if (day === 0 || day === 6) return false
  if (isKoreanHoliday(date)) return false
  return true
}

export function startScheduler(): void {
  stopScheduler()

  const settings = getAllSettings()
  if (settings['scheduler_enabled'] !== 'true') {
    log('스케줄러 비활성화 상태')
    return
  }

  const morningTime = settings['morning_collect_time'] ?? '10:30'
  const afternoonTime = settings['afternoon_collect_time'] ?? '15:30'
  const backupTime = settings['close_backup_time'] ?? '17:30'

  const today = () => new Date().toISOString().slice(0, 10)

  // 오전 주문 수집
  const morningTask = cron.schedule(timeToCron(morningTime), async () => {
    const now = new Date()
    if (!isWorkday(now)) {
      log(`오전 수집 스킵 (비영업일: ${now.toLocaleDateString('ko-KR')})`)
      return
    }
    if (isLocked(`collect_orders:${today()}:morning`)) {
      log('오전 수집 이미 실행 중')
      return
    }
    log(`오전 주문 수집 시작 (${now.toLocaleString('ko-KR')})`)
    const s = getAllSettings()
    const pw = loadPassword()
    if (!s['toever_id'] || !pw) {
      log('오전 수집 실패: 투에버 로그인 정보 없음')
      return
    }
    await collectOrders({
      business_date: today(),
      round: 'morning',
      date_from: today(),
      date_to: today(),
      toever_id: s['toever_id'],
      toever_password: pw,
      emit,
    })
  })

  // 오후 주문 수집
  const afternoonTask = cron.schedule(timeToCron(afternoonTime), async () => {
    const now = new Date()
    if (!isWorkday(now)) {
      log(`오후 수집 스킵 (비영업일: ${now.toLocaleDateString('ko-KR')})`)
      return
    }
    if (isLocked(`collect_orders:${today()}:afternoon`)) {
      log('오후 수집 이미 실행 중')
      return
    }
    log(`오후 주문 수집 시작 (${now.toLocaleString('ko-KR')})`)
    const s = getAllSettings()
    const pw = loadPassword()
    if (!s['toever_id'] || !pw) {
      log('오후 수집 실패: 투에버 로그인 정보 없음')
      return
    }
    await collectOrders({
      business_date: today(),
      round: 'afternoon',
      date_from: today(),
      date_to: today(),
      toever_id: s['toever_id'],
      toever_password: pw,
      emit,
    })
  })

  // 마감 자동 백업
  const backupTask = cron.schedule(timeToCron(backupTime), async () => {
    const now = new Date()
    if (!isWorkday(now)) return
    log(`마감 백업 시작 (${now.toLocaleString('ko-KR')})`)
    const result = await runBackup({
      backup_type: 'AUTO',
      emit: (progress) => {
        emit('progress', { step: progress.message })
        mainWindowRef?.webContents.send('backup:progress', progress)
      },
    })
    if (result.success) {
      log(`마감 백업 완료: ${result.file_count}개 파일`)
    } else {
      log(`마감 백업 실패: ${result.error}`)
    }
  })

  scheduledTasks = [morningTask, afternoonTask, backupTask]
  log(`스케줄러 시작: 오전=${morningTime}, 오후=${afternoonTime}, 백업=${backupTime}`)
}

export function stopScheduler(): void {
  for (const task of scheduledTasks) {
    task.stop()
  }
  scheduledTasks = []
}

export function restartScheduler(): void {
  stopScheduler()
  startScheduler()
}
