import { app, BrowserWindow } from 'electron'
import path from 'path'
import fs from 'fs'
import { initDb, closeDb } from './services/db/schema'
import { setBasePath, ensureAllDirs } from './services/storage'
import { registerIpcHandlers } from './ipc/handlers'
import { startScheduler, setMainWindow } from './services/scheduler'
import { initPlaywrightBrowserPath } from './services/playwright/browserManager'
import { readRestoreMarker } from './services/restore'

// Playwright Chromium을 userData/browsers에 설치하도록 경로 먼저 설정
initPlaywrightBrowserPath()

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: 'Spring Toever Ops',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
    backgroundColor: '#0f172a',
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
    mainWindow?.focus()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(() => {
  // 스토리지 경로 결정:
  // 우선순위: (1) 복원 마커 → (2) D:\SpringToeverOps → (3) AppData fallback
  const DEFAULT_PATH  = 'D:\\SpringToeverOps'
  const FALLBACK_PATH = path.join(app.getPath('userData'), 'SpringToeverOps')

  // 복원 후 재시작 시 마커에서 경로를 읽어 적용
  const restoreMarker = readRestoreMarker()
  if (restoreMarker?.storage_base_path) {
    console.log(`[main] 복원 마커 발견 → 경로 적용: ${restoreMarker.storage_base_path}`)
  }

  let storagePath = restoreMarker?.storage_base_path ?? DEFAULT_PATH
  try {
    fs.mkdirSync(storagePath, { recursive: true })
  } catch {
    // 해당 드라이브가 없으면 AppData 경로로 전환
    storagePath = FALLBACK_PATH
    console.warn(`[main] 저장소 경로 접근 불가 → fallback: ${storagePath}`)
  }

  setBasePath(storagePath)
  let db = initDb(storagePath)

  // DB에 이전에 저장한 사용자 지정 경로가 있으면 적용 (복원 마커 없는 경우)
  if (!restoreMarker) {
    const savedPathRow = db
      .prepare("SELECT value FROM app_settings WHERE key = 'storage_base_path'")
      .get() as { value: string } | undefined

    if (savedPathRow?.value && savedPathRow.value !== storagePath) {
      const newPath = savedPathRow.value
      try {
        fs.mkdirSync(newPath, { recursive: true })
        // 새 경로가 유효하면 DB를 닫고 새 경로에서 재시작
        closeDb()
        setBasePath(newPath)
        storagePath = newPath
        db = initDb(newPath)
        console.log(`[main] 저장된 경로로 DB 전환: ${newPath}`)
      } catch (e) {
        // 새 경로 접근 불가 → 기존 경로 유지
        console.warn(`[main] 저장된 경로 접근 불가 (${newPath}) → 기존 경로 유지: ${storagePath}`, e)
      }
    }
  }

  try {
    ensureAllDirs()
  } catch {
    console.warn('[main] 저장소 디렉토리 생성 실패 - 설정에서 경로를 변경하세요.')
  }

  createWindow()

  if (mainWindow) {
    registerIpcHandlers(mainWindow)
    setMainWindow(mainWindow)
    startScheduler()
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  const { stopScheduler } = require('./services/scheduler')
  try { stopScheduler() } catch { /* ignore */ }
  const { closeDb } = require('./services/db/schema')
  try { closeDb() } catch { /* ignore */ }
})
