import { ipcMain, dialog, shell, BrowserWindow } from 'electron'
import fs from 'fs'
import path from 'path'
import {
  getDashboardStats, searchOrders, getOrderDetail,
  getOpenManualReviews, getManualReviews, updateManualReviewStatus,
  getActiveBatches, cancelEzadminBatch, getAllSettings, setSetting,
  getBackupHistoryList,
} from '../services/db/repositories'
import {
  collectOrders, generateEzadminUploadFile,
  importEzadminInvoice, uploadToeverInvoiceFile,
  isLocked,
} from '../services/toever/orchestrator'
import {
  runBackup, getRunningAutomations, isBackupPathAvailable,
  getLastBackup, getBackupHistory,
} from '../services/backup'
import { savePassword, loadPassword, hasPasswordStored } from '../services/credential'
import { ensureAllDirs, isStorageAvailable, setBasePath, getBasePath } from '../services/storage'
import type {
  SearchOrdersParams, AppSettings,
  CollectOrdersParams, ImportInvoiceParams,
  IpcResult, ManualReviewStatus,
} from '../../shared/types'

export function registerIpcHandlers(mainWindow: BrowserWindow): void {
  // ============================================================
  // ???
  // ============================================================

  ipcMain.handle('settings:getAll', async () => {
    try {
      const all = getAllSettings()
      return {
        success: true,
        data: {
          toever_id:              all['toever_id'] ?? '',
          toever_password:        loadPassword(),       // ????? ??
          storage_base_path:      all['storage_base_path'] ?? 'D:\\SpringToeverOps',
          backup_path:            all['backup_path'] ?? 'E:\\SpringToeverOpsBackup',
          company_cd:             all['company_cd'] ?? '01',
          merchant_cd:            all['merchant_cd'] ?? '0001',
          entr_no:                all['entr_no'] ?? '00117',
          scheduler_enabled:      all['scheduler_enabled'] === 'true',
          morning_collect_time:   all['morning_collect_time'] ?? '10:30',
          afternoon_collect_time: all['afternoon_collect_time'] ?? '15:30',
          close_backup_time:      all['close_backup_time'] ?? '17:30',
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
          // ????? ????? ??
          savePassword(String(value))
        } else {
          setSetting(key, String(value))
        }
      }
      if (settings.storage_base_path) {
        setBasePath(settings.storage_base_path)
        ensureAllDirs()
      }
      return { success: true }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  // ============================================================
  // ???????
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
  // ?? ???
  // ============================================================

  ipcMain.handle('orders:collect', async (_e, params: CollectOrdersParams) => {
    try {
      const settings = getAllSettings()
      const password = loadPassword()
      if (!settings['toever_id'] || !password) {
        return { success: false, error: '??? ID/????? ???? ?????.' }
      }
      if (!isStorageAvailable()) {
        return { success: false, error: '??? ??? ??? ? ????.' }
      }
      if (isLocked(`collect_orders:${params.business_date}:${params.round}`)) {
        return { success: false, error: '?? ?? ????.' }
      }

      const result = await collectOrders({
        ...params,
        toever_id: settings['toever_id'],
        toever_password: password,
        emit: (event, data) => {
          mainWindow.webContents.send('automation:event', { event, data })
        },
      })
      return { success: result.success, data: result }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  // ============================================================
  // ????????????????? ???
  // ============================================================

  ipcMain.handle('ezadmin:generateUploadFile', async (_e, business_date: string) => {
    try {
      const result = generateEzadminUploadFile(business_date)
      if (result.success && result.filePath) {
        // ??? ?????????? ???
        shell.showItemInFolder(result.filePath)
      }
      return { success: result.success, data: result, error: result.error }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  // ============================================================
  // ???????????? import
  // ============================================================

  ipcMain.handle('invoice:importEzadmin', async (_e, params: ImportInvoiceParams) => {
    try {
      const result = await importEzadminInvoice({
        filePath: params.file_path,
        emit: (event, data) => {
          mainWindow.webContents.send('automation:event', { event, data })
        },
      })
      return { success: result.success, data: result }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  ipcMain.handle('invoice:selectFile', async () => {
    try {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: '???????????? ??? ???',
        filters: [
          { name: 'Excel Files', extensions: ['xls', 'xlsx'] },
          { name: 'All Files', extensions: ['*'] },
        ],
        properties: ['openFile'],
      })
      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, error: '??? ??? ??' }
      }
      return { success: true, data: result.filePaths[0] }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  // ============================================================
  // ???????? ?????
  // ============================================================

  ipcMain.handle('invoice:uploadToever', async () => {
    try {
      const settings = getAllSettings()
      const password = loadPassword()
      if (!settings['toever_id'] || !password) {
        return { success: false, error: '??? ID/????? ???? ?????.' }
      }
      if (isLocked('upload_toever_invoice')) {
        return { success: false, error: '?? ??? ????.' }
      }

      const result = await uploadToeverInvoiceFile({
        toever_id: settings['toever_id'],
        toever_password: password,
        emit: (event, data) => {
          mainWindow.webContents.send('automation:event', { event, data })
        },
      })
      return { success: result.success, data: result }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  // ============================================================
  // ?? ???
  // ============================================================

  ipcMain.handle('batch:getActive', async () => {
    try {
      const batches = getActiveBatches()
      return { success: true, data: batches }
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
  // ????????
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
      const backupPath = settings['backup_path'] ?? 'E:\\SpringToeverOpsBackup'
      return {
        success: true,
        data: {
          running_automations: getRunningAutomations(),
          storage_ok:          isStorageAvailable(),
          backup_path_ok:      isBackupPathAvailable(backupPath),
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
          mainWindow.webContents.send('backup:progress', progress)
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
  // ??? ?????
  // ============================================================

  ipcMain.handle('fs:openFolder', async (_e, folderPath: string) => {
    try {
      if (fs.existsSync(folderPath)) {
        shell.openPath(folderPath)
        return { success: true }
      }
      return { success: false, error: '???? ?????? ??????.' }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  ipcMain.handle('fs:storageStatus', async () => {
    return { success: true, data: isStorageAvailable() }
  })
}
