import cron from 'node-cron'
import { getAllSettings } from './db/repositories'
import { collectOrders, isLocked } from './toever/orchestrator'
import { runBackup } from './backup'
import { loadPassword } from './credential'
import { appendLog, logPath, getKSTDateString } from './storage'
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
  // "10:30" -> "30 10 * * 1-5"  (월~금)
  const [h, m] = time.split(':')
  if (!h || !m || isNaN(Number(h)) || isNaN(Number(m))) {
    log(`잘못된 시간 형식: ${time} → 기본값 10:30 사용`)
    return '30 10 * * 1-5'
  }
  return `${m} ${h} * * 1-5`
}

function isKoreanHoliday(_date: Date): boolean {
  // 공휴일 체크 TODO: 공휴일 API 또는 하드코딩 목록 연동
  return false
}

function isWorkday(date: Date): boolean {
  // node-cron은 시스템 로컬 시간 기준이지만,
  // 한국에서는 KST(UTC+9) 기준 요일을 사용해야 midnight 부근 오류를 방지
  const kstDateStr = date.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })
  const kstDate = new Date(kstDateStr + 'T00:00:00+09:00')
  const day = kstDate.getDay() // 0=일, 6=토
  if (day === 0 || day === 6) return false
  if (isKoreanHoliday(kstDate)) return false
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

  // KST 기준 오늘 날짜 (UTC 기준 toISOString()을 쓰면 00:00~08:59 KST에 전날 날짜 반환 버그)
  const todayKST = () => getKSTDateString()

  // 오전 주문 수집
  const morningTask = cron.schedule(timeToCron(morningTime), () => {
    ;(async () => {
      try {
        const now = new Date()
        if (!isWorkday(now)) {
          log(`오전 수집 스킵 (비영업일: ${now.toLocaleDateString('ko-KR')})`)
          return
        }
        const today = todayKST()
        if (isLocked(`collect_orders:${today}:morning`)) {
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
          business_date: today,
          round: 'morning',
          date_from: today,
          date_to: today,
          toever_id: s['toever_id'],
          toever_password: pw,
          emit,
        })
      } catch (e) {
        log(`오전 수집 오류: ${e}`)
      }
    })()
  })

  // 오후 주문 수집
  const afternoonTask = cron.schedule(timeToCron(afternoonTime), () => {
    ;(async () => {
      try {
        const now = new Date()
        if (!isWorkday(now)) {
          log(`오후 수집 스킵 (비영업일: ${now.toLocaleDateString('ko-KR')})`)
          return
        }
        const today = todayKST()
        if (isLocked(`collect_orders:${today}:afternoon`)) {
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
          business_date: today,
          round: 'afternoon',
          date_from: today,
          date_to: today,
          toever_id: s['toever_id'],
          toever_password: pw,
          emit,
        })
      } catch (e) {
        log(`오후 수집 오류: ${e}`)
      }
    })()
  })

  // 마감 자동 백업
  const backupTask = cron.schedule(timeToCron(backupTime), () => {
    ;(async () => {
      try {
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
      } catch (e) {
        log(`마감 백업 오류: ${e}`)
      }
    })()
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