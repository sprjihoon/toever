import cron from 'node-cron'
import { getAllSettings, getScheduleTimes, isHoliday, createRun, updateRunStatus } from './db/repositories'
import { collectOrders, uploadToeverInvoiceFile, isLocked } from './toever/orchestrator'
import { runBackup } from './backup'
import { getToeverCredentials } from './credential'
import { appendLog, logPath, getKSTDateString } from './storage'
import type { BrowserWindow } from 'electron'
import type { ScheduleTimeEntry } from '../../shared/types'

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
  // "10:30" -> "30 10 * * 1-5"  (월~금, 공휴일은 실행 시점에 별도 체크)
  const [h, m] = time.split(':')
  if (!h || !m || isNaN(Number(h)) || isNaN(Number(m))) {
    log(`잘못된 시간 형식: ${time} → 기본값 10:30 사용`)
    return '30 10 * * 1-5'
  }
  return `${m} ${h} * * 1-5`
}

function isWorkday(date: Date): { ok: boolean; reason?: string } {
  // node-cron은 시스템 로컬 시간 기준이지만,
  // 한국에서는 KST(UTC+9) 기준 요일을 사용해야 midnight 부근 오류를 방지
  const kstDateStr = date.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })
  const kstDate = new Date(kstDateStr + 'T00:00:00+09:00')
  const day = kstDate.getDay() // 0=일, 6=토
  if (day === 0 || day === 6) return { ok: false, reason: '주말' }
  if (isHoliday(kstDateStr)) return { ok: false, reason: '공휴일/회사휴일' }
  return { ok: true }
}

/** 스케줄에 등록된 시간대별 주문수집 cron task 생성 */
function scheduleCollectTask(entry: ScheduleTimeEntry): cron.ScheduledTask {
  return cron.schedule(timeToCron(entry.time), () => {
    ;(async () => {
      try {
        const now = new Date()
        const workday = isWorkday(now)
        if (!workday.ok) {
          log(`${entry.label} 스킵 (${workday.reason}: ${now.toLocaleDateString('ko-KR')})`)
          return
        }
        const today = getKSTDateString()
        if (isLocked(`collect_orders:${today}:${entry.id}`)) {
          log(`${entry.label} 이미 실행 중`)
          return
        }
        log(`${entry.label} 시작 (${now.toLocaleString('ko-KR')})`)
        const creds = getToeverCredentials()
        if (!creds.ok) {
          log(`${entry.label} 실패: ${creds.error}`)
          return
        }
        await collectOrders({
          business_date: today,
          round: entry.id,
          date_from: today,
          date_to: today,
          toever_id: creds.id,
          toever_password: creds.password,
          emit,
        })
      } catch (e) {
        log(`${entry.label} 오류: ${e}`)
      }
    })()
  })
}

/** 투에버 송장 자동 업로드 (이지어드민 송장 임포트는 여전히 수동, 투에버 업로드만 자동화) */
function scheduleInvoiceUploadTask(time: string): cron.ScheduledTask {
  return cron.schedule(timeToCron(time), () => {
    ;(async () => {
      try {
        const now = new Date()
        const workday = isWorkday(now)
        if (!workday.ok) {
          log(`송장 자동 업로드 스킵 (${workday.reason}: ${now.toLocaleDateString('ko-KR')})`)
          return
        }
        if (isLocked('upload_toever_invoice')) {
          log('송장 업로드 이미 실행 중')
          return
        }
        const creds = getToeverCredentials()
        if (!creds.ok) {
          log(`송장 자동 업로드 실패: ${creds.error}`)
          return
        }
        const today = getKSTDateString()
        const run = createRun('UPLOAD_TOEVER_INVOICE', today,
          `upload_invoice:${today}:${Date.now()}:auto`)
        log(`송장 자동 업로드 시작 (${now.toLocaleString('ko-KR')})`)
        try {
          const result = await uploadToeverInvoiceFile({
            toever_id: creds.id,
            toever_password: creds.password,
            run_id: run.id,
            emit,
          })
          const summary = result.success
            ? `${result.uploaded}건 송장 업로드`
            : result.errors.join('; ')
          updateRunStatus(run.id, result.success ? 'SUCCESS' : 'FAILED', summary)
          log(result.success ? `송장 자동 업로드 완료: ${summary}` : `송장 자동 업로드 실패: ${summary}`)
        } catch (e) {
          updateRunStatus(run.id, 'FAILED', String(e))
          log(`송장 자동 업로드 오류: ${e}`)
        }
      } catch (e) {
        log(`송장 자동 업로드 오류: ${e}`)
      }
    })()
  })
}

export function startScheduler(): void {
  stopScheduler()

  const settings = getAllSettings()
  if (settings['scheduler_enabled'] !== 'true') {
    log('스케줄러 비활성화 상태')
    return
  }

  const scheduleTimes = getScheduleTimes()
  const backupTime = settings['close_backup_time'] ?? '17:30'
  // 미설정(최초 실행) 시 기본값 16:00 으로 자동 업로드 활성화 (settings:getAll 기본값과 동일하게 유지).
  // 사용자가 Settings 화면에서 "끄기"로 명시적으로 빈 문자열을 저장한 경우에만 비활성화됨.
  const invoiceUploadTime = settings['invoice_upload_time'] ?? '16:00'

  const collectTasks = scheduleTimes.map(entry => scheduleCollectTask(entry))
  const invoiceUploadTasks = invoiceUploadTime.trim() !== ''
    ? [scheduleInvoiceUploadTask(invoiceUploadTime)]
    : []

  // 마감 자동 백업
  const backupTask = cron.schedule(timeToCron(backupTime), () => {
    ;(async () => {
      try {
        const now = new Date()
        if (!isWorkday(now).ok) return
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

  scheduledTasks = [...collectTasks, ...invoiceUploadTasks, backupTask]
  const scheduleSummary = scheduleTimes.map(s => `${s.label}=${s.time}`).join(', ')
  const invoiceSummary = invoiceUploadTime.trim() !== '' ? `, 송장업로드=${invoiceUploadTime}` : ', 송장업로드=비활성'
  log(`스케줄러 시작: ${scheduleSummary}${invoiceSummary}, 백업=${backupTime}`)
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
