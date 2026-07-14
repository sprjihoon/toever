import { app, ipcMain, dialog, shell, BrowserWindow } from 'electron'
import path from 'path'
import fs from 'fs'
import {
  getDashboardStats, searchOrders, getOrderDetail,
  getOpenManualReviews, getManualReviews, updateManualReviewStatus,
  getActiveBatches, cancelEzadminBatch, getAllSettings, setSetting, getSetting,
  getBackupHistoryList, getReportData, getReportTemplates, saveReportTemplate, deleteReportTemplate, buildReport,
  createRun, updateRunStatus, getRecentArtifacts,
  clearTodayOrderData,
  getScheduleTimes, setScheduleTimes,
  getHolidays, addCompanyHoliday, deleteHoliday,
} from '../services/db/repositories'
import { getDb } from '../services/db/schema'
import { getKSTDateString } from '../services/storage'
import {
  collectOrders, generateEzadminUploadFile,
  importEzadminInvoice, uploadToeverInvoiceFile,
  previewToeverInvoiceUpload, getDailyInvoiceStatus,
  generateToeverInvoiceUploadPreview,
  isLocked,
} from '../services/toever/orchestrator'
import {
  runBackup, getRunningAutomations, isBackupPathAvailable,
  getLastBackup,
} from '../services/backup'
import { restoreFromBackup, validateBackupFolder } from '../services/restore'
import { savePassword, hasPasswordStored, canLoadPassword, getToeverCredentials } from '../services/credential'
import { ensureAllDirs, isStorageAvailable, setBasePath, getBasePath } from '../services/storage'
import { isChromiumInstalled, installChromium } from '../services/playwright/browserManager'
import { restartScheduler } from '../services/scheduler'
import { resetAllData } from '../services/reset'
import { syncPublicHolidaysForYears } from '../services/holidaySync'
import type {
  SearchOrdersParams, AppSettings,
  CollectOrdersParams, ImportInvoiceParams,
  IpcResult, ManualReviewStatus, ReportParams, ReportBuildParams,
  ScheduleTimeEntry,
} from '../../shared/types'

export function registerIpcHandlers(mainWindow: BrowserWindow): void {
  // ============================================================
  // ??
  // ============================================================

  ipcMain.handle('settings:getAll', async () => {
    try {
      const all = getAllSettings()
      return {
        success: true,
        data: {
          toever_id:              all['toever_id'] ?? '',
          toever_password:        '',
          has_stored_password:    hasPasswordStored(),
          password_readable:      canLoadPassword(),
          storage_base_path:      all['storage_base_path'] ?? '',
          backup_path:            all['backup_path'] ?? '',
          scheduler_enabled:      all['scheduler_enabled'] === 'true',
          collect_schedule:       getScheduleTimes(),
          // 미설정(최초 실행) 시 기본값 16:00 자동 활성화. 명시적으로 빈 문자열 저장하면 비활성화된 상태로 유지.
          invoice_upload_time:    all['invoice_upload_time'] ?? '16:00',
          close_backup_time:      all['close_backup_time'] ?? '17:30',
          public_data_api_key:    all['public_data_api_key'] ?? '',
        },
      }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  ipcMain.handle('settings:save', async (_e, settings: AppSettings) => {
    try {
      for (const [key, value] of Object.entries(settings)) {
        if (key === 'toever_password') {
          // 빈 문자열이면 저장 건너뜀 (삭제 방지)
          if (String(value).trim() !== '') {
            savePassword(String(value).trim())
          }
        } else if (key === 'toever_id') {
          setSetting(key, String(value).trim())
        } else if (key === 'collect_schedule') {
          setScheduleTimes(value as ScheduleTimeEntry[])
        } else if (key !== 'has_stored_password' && key !== 'password_readable') {
          setSetting(key, String(value))
        }
      }
      const prevStoragePath = getBasePath()
      const needsRestart = Boolean(
        settings.storage_base_path &&
        settings.storage_base_path !== prevStoragePath
      )

      if (settings.storage_base_path && !needsRestart) {
        // ??? ??? ?? ???? ?? ?? (???? ??)
        setBasePath(settings.storage_base_path)
        try { ensureAllDirs() } catch { /* ???? ?? ??? ?? */ }
      }
      // ??? ????? DB? ??? ?? ?? ? ?? setBasePath ??
      // (DB? ??? ? ??? ???? ????? split-brain ??)

      try { restartScheduler() } catch { /* ???? ??? ?? ?? */ }

      return { success: true, data: { needsRestart } }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  ipcMain.handle('settings:testLogin', async () => {
    const creds = getToeverCredentials()
    if (!creds.ok) {
      return { success: false, error: creds.error }
    }

    const { launchBrowser, loginToever, closeBrowser } = require('../services/toever/browser')
    const { DIRS } = require('../services/storage')

    try {
      const session = await launchBrowser(DIRS.logsScreenshots())
      try {
        const result = await loginToever(session.page, creds.id, creds.password)
        return {
          success: result.success,
          error: result.error,
          data: { sessionReused: result.sessionReused ?? false },
        }
      } finally {
        await closeBrowser()
      }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  // ============================================================
  // ????
  // ============================================================

  ipcMain.handle('dashboard:getStats', async (_e, today: string) => {
    try {
      const stats = getDashboardStats(today)
      return { success: true, data: stats }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  // ============================================================
  // ??
  // ============================================================

  ipcMain.handle('orders:search', async (_e, params: SearchOrdersParams) => {
    try {
      const result = searchOrders(params)
      return { success: true, data: result }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  ipcMain.handle('orders:getDetail', async (_e, id: number) => {
    try {
      const detail = getOrderDetail(id)
      return { success: true, data: detail }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  // ============================================================
  // ?? ?? ??
  // ============================================================

  ipcMain.handle('orders:collect', async (_e, params: CollectOrdersParams) => {
    try {
      const creds = getToeverCredentials()
      if (!creds.ok) {
        return { success: false, error: creds.error }
      }
      if (!isStorageAvailable()) {
        return { success: false, error: '저장소에 접근할 수 없습니다.' }
      }
      if (isLocked(`collect_orders:${params.business_date}:${params.round}`)) {
        return { success: false, error: '이미 실행 중입니다.' }
      }

      const result = await collectOrders({
        ...params,
        toever_id: creds.id,
        toever_password: creds.password,
        emit: (event, data) => {
          mainWindow?.webContents.send('automation:event', { event, data })
        },
      })
      return { success: result.success, data: result }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  ipcMain.handle('orders:clearToday', async (_e, orderDate?: string) => {
    try {
      const date = orderDate ?? getKSTDateString()
      const result = clearTodayOrderData(date)
      return { success: true, data: result }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  // ============================================================
  // ????? ??? ?? ??
  // ============================================================

  ipcMain.handle('ezadmin:generateUploadFile', async (_e, business_date: string, round?: string) => {
    try {
      const result = generateEzadminUploadFile(
        business_date,
        undefined,
        (round as 'morning' | 'afternoon' | 'manual') ?? 'manual'
      )
      if (result.success && result.filePath) {
        shell.showItemInFolder(result.filePath)
      }
      return { success: result.success, data: result, error: result.error }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  // ============================================================
  // ????? ?? import
  // ============================================================

  ipcMain.handle('invoice:importEzadmin', async (_e, params: ImportInvoiceParams) => {
    const today = getKSTDateString()
    const run = createRun('IMPORT_INVOICE', today, `import_invoice:${today}:${Date.now()}`, 'manual')
    try {
      const result = await importEzadminInvoice({
        filePath: params.file_path,
        run_id: run.id,
        emit: (event, data) => {
          mainWindow?.webContents.send('automation:event', { event, data })
        },
      })
      updateRunStatus(run.id, result.success ? 'SUCCESS' : 'FAILED',
        result.success ? `${result.matched}건 처리` : result.errors.join('; '))
      return { success: result.success, data: result }
    } catch (e) {
      updateRunStatus(run.id, 'FAILED', String(e))
      return { success: false, error: String(e) }
    }
  })

  ipcMain.handle('invoice:selectFile', async () => {
    try {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: '이지어드민 송장 파일 선택',
        filters: [
          { name: 'Excel Files', extensions: ['xls', 'xlsx'] },
          { name: 'All Files', extensions: ['*'] },
        ],
        properties: ['openFile'],
      })
      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, error: '선택 취소됨' }
      }
      return { success: true, data: result.filePaths[0] }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  // ============================================================
  // ??? ?? ???
  // ============================================================

  /** 일일 송장 업로드 현황 조회 (대기 건수 + 오늘 업로드 여부) */
  ipcMain.handle('invoice:getDailyStatus', async () => {
    try {
      const today = getKSTDateString()
      const status = getDailyInvoiceStatus(today)
      return { success: true, data: status }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  /** 송장 업로드 대상 목록만 반환 (브라우저 없음, 상태 변경 없음) */
  ipcMain.handle('invoice:previewUpload', async () => {
    try {
      const preview = previewToeverInvoiceUpload()
      return { success: true, data: preview }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  /** 실제 업로드 xls 파일 생성 (상태 변경 없음, 업로드 전 확인용) */
  ipcMain.handle('invoice:generatePreviewFile', async () => {
    try {
      const preview = generateToeverInvoiceUploadPreview()
      return { success: true, data: preview }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  /**
   * ??? ?? ??? ??
   * - confirmed=true ?? ???? CONFIRM_REQUIRED ?? ?? (?? ? ?)
   * - dryRun=true(???): uploadBtn ?? ?? ?? ????? ??
   */
  ipcMain.handle('invoice:uploadToever', async (_e, params?: {
    confirmed?: boolean
    dryRun?: boolean
  }) => {
    if (!params?.confirmed) {
      return {
        success: false,
        error: 'CONFIRM_REQUIRED',
        message: '업로드를 확인해주세요. confirmed:true 를 전달하세요.',
      }
    }

    const creds = getToeverCredentials()
    if (!creds.ok) {
      return { success: false, error: creds.error }
    }
    if (isLocked('upload_toever_invoice')) {
      return { success: false, error: '이미 실행 중입니다.' }
    }

    const dryRun = params?.dryRun ?? false
    const today  = getKSTDateString()
    const run    = createRun('UPLOAD_TOEVER_INVOICE', today,
      `upload_invoice:${today}:${Date.now()}:${dryRun ? 'dry' : 'real'}`, 'manual')
    try {
      const result = await uploadToeverInvoiceFile({
        toever_id:     creds.id,
        toever_password: creds.password,
        run_id:        run.id,
        dryRun,
        emit: (event, data) => {
          mainWindow?.webContents.send('automation:event', { event, data })
        },
      })
      const summary = result.dryRun
        ? 'DRY-RUN 완료 (실제 업로드 없음)'
        : result.success
          ? `${result.uploaded}건 송장 업로드`
          : result.errors.join('; ')
      updateRunStatus(run.id, result.success ? 'SUCCESS' : 'FAILED', summary)
      return { success: result.success, data: result }
    } catch (e) {
      updateRunStatus(run.id, 'FAILED', String(e))
      return { success: false, error: String(e) }
    }
  })

  // ============================================================
  // ?? ??
  // ============================================================

  ipcMain.handle('batch:getActive', async () => {
    try {
      return { success: true, data: getActiveBatches() }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  ipcMain.handle('batch:cancel', async (_e, batchId: number, reason: string) => {
    try {
      cancelEzadminBatch(batchId, reason)
      return { success: true }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  // ============================================================
  // ????
  // ============================================================

  ipcMain.handle('review:getOpen', async () => {
    try {
      return { success: true, data: getOpenManualReviews() }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  ipcMain.handle('review:getAll', async (_e, limit: number, offset: number) => {
    try {
      return { success: true, data: getManualReviews(limit, offset) }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  ipcMain.handle('review:updateStatus', async (
    _e,
    id: number,
    status: ManualReviewStatus,
    memo?: string,
    resolved_by?: string
  ): Promise<IpcResult> => {
    try {
      updateManualReviewStatus(id, status, memo, resolved_by)
      return { success: true }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  // ============================================================
  // ??
  // ============================================================

  ipcMain.handle('backup:status', async () => {
    try {
      const settings = getAllSettings()
      const backupPath = settings['backup_path'] ?? ''
      return {
        success: true,
        data: {
          running_automations: getRunningAutomations(),
          storage_ok:          isStorageAvailable(),
          backup_path_ok:      backupPath ? isBackupPathAvailable(backupPath) : false,
          backup_path:         backupPath,
          last_backup:         getLastBackup(),
        },
      }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  ipcMain.handle('backup:run', async (_e, backupType: 'AUTO' | 'MANUAL' = 'MANUAL') => {
    try {
      const result = await runBackup({
        backup_type: backupType,
        emit: (progress) => {
          mainWindow?.webContents.send('backup:progress', progress)
        },
      })
      return { success: result.success, data: result, error: result.error }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  ipcMain.handle('backup:getHistory', async (_e, limit = 20) => {
    try {
      return { success: true, data: getBackupHistoryList(limit) }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  // ============================================================
  // ?? ???
  // ============================================================

  ipcMain.handle('fs:storageStatus', async () => {
    return { success: true, data: isStorageAvailable() }
  })

  // ??? ????? ?? ??? ??
  ipcMain.handle('fs:showInFolder', async (_e, filePath: string) => {
    try {
      if (fs.existsSync(filePath)) {
        shell.showItemInFolder(filePath)
        return { success: true }
      }
      return { success: false, error: `파일 없음: ${filePath}` }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  // ?? ?? ?? ?? (file_artifact)
  ipcMain.handle('artifacts:getRecent', async (_e, limit = 30) => {
    try {
      return { success: true, data: getRecentArtifacts(limit) }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  ipcMain.handle('fs:openFolder', async (_e, folderPath: string) => {
    try {
      if (fs.existsSync(folderPath)) {
        await shell.openPath(folderPath)
        return { success: true }
      }
      return { success: false, error: '폴더를 찾을 수 없습니다.' }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  ipcMain.handle('fs:selectFolder', async (_e, options?: { title?: string; defaultPath?: string }) => {
    try {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: options?.title ?? '폴더 선택',
        defaultPath: options?.defaultPath,
        properties: ['openDirectory'],
      })
      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, error: '취소됨' }
      }
      return { success: true, data: result.filePaths[0] }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  // ============================================================
  // ?? ??
  // ============================================================

  ipcMain.handle('backup:selectRestoreFolder', async () => {
    try {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: '백업 폴더 선택',
        properties: ['openDirectory'],
        buttonLabel: '이 폴더로 복원',
      })
      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, error: '취소됨' }
      }
      return { success: true, data: result.filePaths[0] }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  ipcMain.handle('backup:validateRestore', async (_e, folderPath: string) => {
    try {
      const v = validateBackupFolder(folderPath)
      return { success: v.valid, data: v, error: v.error }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  ipcMain.handle('backup:restore', async (_e, folderPath: string) => {
    try {
      const result = await restoreFromBackup(folderPath, undefined, (progress) => {
        mainWindow?.webContents.send('restore:progress', progress)
      })
      return { success: result.success, data: result, error: result.error }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  // 앱 버전 조회
  ipcMain.handle('app:getVersion', () => {
    return { success: true, data: app.getVersion() }
  })

  // 앱 재시작
  ipcMain.handle('app:relaunch', async () => {
    app.relaunch()
    app.quit()
    return { success: true }
  })

  // ?? ?? ??: setup_completed ???? ?? (?? 0? ??? ????? ?? ??? ?? ??)
  ipcMain.handle('app:isFirstRun', async () => {
    try {
      const setupDone = getSetting('setup_completed') === 'true'
      return { success: true, data: !setupDone }
    } catch {
      return { success: true, data: true }
    }
  })

  // ?? ?? ?? ??
  ipcMain.handle('app:markSetupComplete', async () => {
    try {
      setSetting('setup_completed', 'true')
      return { success: true }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  // ?? ?? ?? ?? (??? ?? ?? ??)
  ipcMain.handle('app:getDefaultStoragePath', async () => {
    const defaultPath = path.join(app.getPath('documents'), 'SpringToeverOps')
    return { success: true, data: defaultPath }
  })

  // ============================================================
  // Playwright Chromium ??
  // ============================================================

  ipcMain.handle('playwright:isChromiumInstalled', async () => {
    return { success: true, data: isChromiumInstalled() }
  })

  ipcMain.handle('playwright:installChromium', async () => {
    try {
      const result = await installChromium((progress) => {
        mainWindow?.webContents.send('playwright:installProgress', progress)
      })
      return { success: result.success, error: result.error }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  // ============================================================
  // ???
  // ============================================================

  ipcMain.handle('report:getData', async (_e, params: ReportParams) => {
    try {
      const data = getReportData(params)
      return { success: true, data }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })
  ipcMain.handle('report:getTemplates', async () => {
    try { return { success: true, data: getReportTemplates() } }
    catch (e) { return { success: false, error: String(e) } }
  })

  ipcMain.handle('report:saveTemplate', async (_e, name: string, description: string | null, widgets: unknown[], existingId?: number) => {
    try {
      const saved = saveReportTemplate(name, description, widgets as never, existingId)
      return { success: true, data: saved }
    } catch (e) { return { success: false, error: String(e) } }
  })

  ipcMain.handle('report:deleteTemplate', async (_e, id: number) => {
    try { deleteReportTemplate(id); return { success: true } }
    catch (e) { return { success: false, error: String(e) } }
  })

  ipcMain.handle('report:buildReport', async (_e, params: ReportBuildParams) => {
    try { return { success: true, data: buildReport(params) } }
    catch (e) { return { success: false, error: String(e) } }
  })

  // ============================================================
  // 휴일 (스케줄러 자동수집/업로드/백업 스킵)
  // ============================================================

  ipcMain.handle('holiday:getList', async (_e, date_from?: string, date_to?: string) => {
    try {
      return { success: true, data: getHolidays(date_from, date_to) }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  ipcMain.handle('holiday:addCompany', async (_e, date: string, name: string) => {
    try {
      const item = addCompanyHoliday(date, name)
      return { success: true, data: item }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  ipcMain.handle('holiday:delete', async (_e, id: number) => {
    try {
      deleteHoliday(id)
      return { success: true }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  /** 공공데이터포털 API로 지정 연도들의 공휴일 동기화 (인증키 미설정 시 오류 반환) */
  ipcMain.handle('holiday:syncFromApi', async (_e, years: number[]) => {
    try {
      const apiKey = getSetting('public_data_api_key') ?? ''
      if (!apiKey.trim()) {
        return { success: false, error: '설정에서 공공데이터포털 API 인증키를 먼저 입력해주세요.' }
      }
      const results = await syncPublicHolidaysForYears(apiKey, years)
      const failed = results.filter(r => !r.success)
      return { success: failed.length === 0, data: results, error: failed[0]?.error }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  // ============================================================
  // 전체 데이터 초기화
  // ============================================================

  /**
   * 전체 데이터 초기화 — DB 전체 초기화 + 생성/업로드/원본 파일 전체 삭제
   * - 실행 중인 자동화 작업이 있으면 차단
   * - confirmed=true 없으면 CONFIRM_REQUIRED 반환 (실수 방지)
   * - 되돌릴 수 없음 (앱 재시작 필요)
   */
  ipcMain.handle('system:resetAll', async (_e, params?: { confirmed?: boolean }) => {
    if (!params?.confirmed) {
      return {
        success: false,
        error: 'CONFIRM_REQUIRED',
        message: '전체 초기화를 확인해주세요. confirmed:true 를 전달하세요.',
      }
    }
    const running = getRunningAutomations()
    if (running.length > 0) {
      return { success: false, error: `실행 중인 작업이 있어 초기화할 수 없습니다: ${running.map(r => r.label).join(', ')}` }
    }
    try {
      const result = resetAllData()
      return { success: true, data: result }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })
}