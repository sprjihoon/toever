import { app, BrowserWindow } from 'electron'
import path from 'path'
import fs from 'fs'
import { initDb } from './services/db/schema'
import { setBasePath, ensureAllDirs } from './services/storage'
import { registerIpcHandlers } from './ipc/handlers'
import { startScheduler, setMainWindow } from './services/scheduler'

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
  // 우선순위: (1) 이전에 저장된 설정 → (2) D:\SpringToeverOps → (3) AppData fallback
  const DEFAULT_PATH  = 'D:\\SpringToeverOps'
  const FALLBACK_PATH = path.join(app.getPath('userData'), 'SpringToeverOps')

  let storagePath = DEFAULT_PATH
  try {
    fs.mkdirSync(storagePath, { recursive: true })
  } catch {
    // D: 드라이브가 없으면 AppData 경로로 전환
    storagePath = FALLBACK_PATH
    console.warn(`[main] 기본 저장소 경로(D:) 접근 불가 → fallback: ${storagePath}`)
  }

  setBasePath(storagePath)
  const db = initDb(storagePath)

  // DB에 이전에 저장한 사용자 지정 경로가 있으면 적용
  const savedPathRow = db
    .prepare("SELECT value FROM app_settings WHERE key = 'storage_base_path'")
    .get() as { value: string } | undefined

  if (savedPathRow?.value && savedPathRow.value !== storagePath) {
    setBasePath(savedPathRow.value)
    storagePath = savedPathRow.value
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
