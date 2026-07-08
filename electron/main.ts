import { app, BrowserWindow } from 'electron'
import path from 'path'
import { initDb } from './services/db/schema'
import { getAllSettings, setSetting } from './services/db/repositories'
import { setBasePath, ensureAllDirs, getBasePath } from './services/storage'
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
  // DB 초기화
  const storagePath = 'D:\\SpringToeverOps'
  setBasePath(storagePath)

  const db = initDb(storagePath)

  // 설정에서 저장소 경로 읽기
  const savedPath = db.prepare("SELECT value FROM app_settings WHERE key = 'storage_base_path'").get() as { value: string } | undefined
  if (savedPath?.value) {
    setBasePath(savedPath.value)
  }

  try {
    ensureAllDirs()
  } catch {
    // 저장소 없으면 경고만 - 업무 중단 안 함
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
