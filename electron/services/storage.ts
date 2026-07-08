import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

// 기본값은 빈 문자열 - 반드시 setBasePath()로 초기화 후 사용
let basePath = ''

export function setBasePath(p: string): void {
  basePath = p
}

export function getBasePath(): string {
  return basePath
}

export function isBasePathSet(): boolean {
  return basePath !== ''
}

export const DIRS = {
  database: () => path.join(basePath, 'database'),
  rawToeverOrders: () => path.join(basePath, 'raw', 'toever_orders'),
  rawToeverInventory: () => path.join(basePath, 'raw', 'toever_inventory'),
  rawEzadminInvoice: () => path.join(basePath, 'raw', 'ezadmin_invoice'),
  generatedEzadminUpload: () => path.join(basePath, 'generated', 'ezadmin_upload'),
  generatedToeverInvoiceUpload: () => path.join(basePath, 'generated', 'toever_invoice_upload'),
  generatedReports: () => path.join(basePath, 'generated', 'reports'),
  pdfContracts: () => path.join(basePath, 'pdf', 'contracts'),
  logsAutomation: () => path.join(basePath, 'logs', 'automation'),
  logsScreenshots: () => path.join(basePath, 'logs', 'screenshots'),
  backupTemp: () => path.join(basePath, 'backup_temp'),
}

export function ensureAllDirs(): void {
  for (const dirFn of Object.values(DIRS)) {
    const dir = dirFn()
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
  }
}

export function sha256OfFile(filePath: string): string {
  const buffer = fs.readFileSync(filePath)
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

export function sha256OfBuffer(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex')
}

export function saveRawFile(
  dir: string,
  filename: string,
  data: Buffer | string
): string {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  const dest = path.join(dir, filename)
  fs.writeFileSync(dest, data)
  return dest
}

export function buildDatePrefix(date?: string): string {
  const d = date ?? getKSTDateString()
  return d.replace(/-/g, '')
}

/**
 * 한국 표준시(KST = UTC+9) 기준 오늘 날짜를 'YYYY-MM-DD' 형식으로 반환한다.
 * UTC 기준 toISOString()을 사용하면 00:00~08:59 KST 구간에 전날 날짜가 반환되는 버그가 있다.
 */
export function getKSTDateString(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })
}

export function uniqueFilename(prefix: string, ext: string): string {
  const ts = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 17)
  return `${prefix}_${ts}.${ext}`
}

export function screenshotPath(label: string): string {
  const dir = DIRS.logsScreenshots()
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  const ts = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 17)
  return path.join(dir, `${ts}_${label}.png`)
}

export function logPath(label: string, date?: string): string {
  const dir = DIRS.logsAutomation()
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  const d = (date ?? new Date().toISOString().slice(0, 10)).replace(/-/g, '')
  return path.join(dir, `${d}_${label}.log`)
}

export function appendLog(logFile: string, message: string): void {
  const ts = new Date().toISOString()
  fs.appendFileSync(logFile, `[${ts}] ${message}\n`, 'utf8')
}

export function isStorageAvailable(): boolean {
  if (!basePath) return false
  try {
    ensureAllDirs()
    const testFile = path.join(DIRS.database(), '.access_test')
    fs.writeFileSync(testFile, 'ok')
    fs.unlinkSync(testFile)
    return true
  } catch {
    return false
  }
}
