import { contextBridge, ipcRenderer } from 'electron'

const api = {
  // 설정
  settings: {
    getAll: () => ipcRenderer.invoke('settings:getAll'),
    save: (settings: unknown) => ipcRenderer.invoke('settings:save', settings),
  },

  // 대시보드
  dashboard: {
    getStats: (today: string) => ipcRenderer.invoke('dashboard:getStats', today),
  },

  // 주문
  orders: {
    search: (params: unknown) => ipcRenderer.invoke('orders:search', params),
    getDetail: (id: number) => ipcRenderer.invoke('orders:getDetail', id),
    collect: (params: unknown) => ipcRenderer.invoke('orders:collect', params),
  },

  // 이지어드민
  ezadmin: {
    generateUploadFile: (businessDate: string, round?: string) =>
      ipcRenderer.invoke('ezadmin:generateUploadFile', businessDate, round),
  },

  // 송장
  invoice: {
    importEzadmin: (params: unknown) => ipcRenderer.invoke('invoice:importEzadmin', params),
    selectFile: () => ipcRenderer.invoke('invoice:selectFile'),
    uploadToever: () => ipcRenderer.invoke('invoice:uploadToever'),
  },

  // 배치
  batch: {
    getActive: () => ipcRenderer.invoke('batch:getActive'),
    cancel: (id: number, reason: string) => ipcRenderer.invoke('batch:cancel', id, reason),
  },

  // 수동검토
  review: {
    getOpen: () => ipcRenderer.invoke('review:getOpen'),
    getAll: (limit: number, offset: number) => ipcRenderer.invoke('review:getAll', limit, offset),
    updateStatus: (id: number, status: string, memo?: string, resolvedBy?: string) =>
      ipcRenderer.invoke('review:updateStatus', id, status, memo, resolvedBy),
  },

  // 백업
  backup: {
    status:     ()                              => ipcRenderer.invoke('backup:status'),
    run:        (type?: 'AUTO' | 'MANUAL')      => ipcRenderer.invoke('backup:run', type),
    getHistory: (limit?: number)                => ipcRenderer.invoke('backup:getHistory', limit),
    onProgress: (cb: (p: unknown) => void) => {
      const handler = (_: unknown, p: unknown) => cb(p)
      ipcRenderer.on('backup:progress', handler)
      return () => ipcRenderer.removeListener('backup:progress', handler)
    },
    selectRestoreFolder: () => ipcRenderer.invoke('backup:selectRestoreFolder'),
    validateRestore: (folderPath: string) => ipcRenderer.invoke('backup:validateRestore', folderPath),
    restore: (folderPath: string) => ipcRenderer.invoke('backup:restore', folderPath),
    onRestoreProgress: (cb: (p: unknown) => void) => {
      const handler = (_: unknown, p: unknown) => cb(p)
      ipcRenderer.on('restore:progress', handler)
      return () => ipcRenderer.removeListener('restore:progress', handler)
    },
  },

  // 파일 시스템
  fs: {
    openFolder:   (folderPath: string) => ipcRenderer.invoke('fs:openFolder', folderPath),
    storageStatus: () => ipcRenderer.invoke('fs:storageStatus'),
    selectFolder:  (options?: { title?: string; defaultPath?: string }) =>
      ipcRenderer.invoke('fs:selectFolder', options),
  },

  // 앱 제어
  appControl: {
    isFirstRun:          () => ipcRenderer.invoke('app:isFirstRun'),
    relaunch:            () => ipcRenderer.invoke('app:relaunch'),
    getDefaultStoragePath: () => ipcRenderer.invoke('app:getDefaultStoragePath'),
  },

  // Playwright Chromium
  playwright: {
    isChromiumInstalled: () => ipcRenderer.invoke('playwright:isChromiumInstalled'),
    installChromium: () => ipcRenderer.invoke('playwright:installChromium'),
    onInstallProgress: (cb: (p: unknown) => void) => {
      const handler = (_: unknown, p: unknown) => cb(p)
      ipcRenderer.on('playwright:installProgress', handler)
      return () => ipcRenderer.removeListener('playwright:installProgress', handler)
    },
  },

  // 리포트
  report: {
    getData:       (params: unknown) => ipcRenderer.invoke('report:getData', params),
    getTemplates:  () => ipcRenderer.invoke('report:getTemplates'),
    saveTemplate:  (name: string, description: string | null, widgets: unknown[], existingId?: number) =>
      ipcRenderer.invoke('report:saveTemplate', name, description, widgets, existingId),
    deleteTemplate: (id: number) => ipcRenderer.invoke('report:deleteTemplate', id),
    buildReport:   (params: unknown) => ipcRenderer.invoke('report:buildReport', params),
  },

  // 수기건
  manual: {
    create:  (params: unknown)                     => ipcRenderer.invoke('manual:create', params),
    update:  (id: number, params: unknown)         => ipcRenderer.invoke('manual:update', id, params),
    delete:  (id: number)                          => ipcRenderer.invoke('manual:delete', id),
    getList: (params: unknown)                     => ipcRenderer.invoke('manual:getList', params),
  },

  // 자동화 이벤트 구독
  onAutomationEvent: (callback: (event: string, data: unknown) => void) => {
    const handler = (_: unknown, payload: { event: string; data: unknown }) => {
      callback(payload.event, payload.data)
    }
    ipcRenderer.on('automation:event', handler)
    return () => ipcRenderer.removeListener('automation:event', handler)
  },
}

contextBridge.exposeInMainWorld('toeverApi', api)

export type ToeverApi = typeof api