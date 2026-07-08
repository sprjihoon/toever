/**
 * 백업 복원 서비스
 *
 * 백업 폴더 구조:
 *   <backup_root>/
 *     database/toever_ops.db
 *     raw/toever_orders/
 *     raw/ezadmin_invoice/
 *     generated/ezadmin_upload/
 *     generated/toever_invoice_upload/
 *     generated/reports/
 *     pdf/contracts/
 *     logs/automation/
 *     logs/screenshots/
 *
 * 복원 완료 후 app.relaunch() + app.quit()으로 재시작
 */

import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import { closeDb } from './db/schema'
import { setBasePath, getBasePath } from './storage'

export interface RestoreValidation {
  valid: boolean
  error?: string
  db_size_mb?: number
  file_count?: number
  backup_date?: string
}

export interface RestoreResult {
  success: boolean
  error?: string
  db_restored: boolean
  files_restored: number
}

export interface RestoreProgress {
  phase: 'VALIDATE' | 'DB' | 'FILES' | 'DONE' | 'ERROR'
  message: string
  percent: number
}

/**
 * 백업 폴더 유효성 검사
 */
export function validateBackupFolder(folderPath: string): RestoreValidation {
  try {
    if (!fs.existsSync(folderPath)) {
      return { valid: false, error: '폴더를 찾을 수 없습니다.' }
    }

    const dbPath = path.join(folderPath, 'database', 'toever_ops.db')
    if (!fs.existsSync(dbPath)) {
      return { valid: false, error: '유효한 백업 폴더가 아닙니다. (database/toever_ops.db 없음)' }
    }

    const dbStat = fs.statSync(dbPath)
    const dbSizeMb = dbStat.size / 1024 / 1024

    // 폴더 내 파일 카운트
    let fileCount = 0
    function countFiles(dir: string) {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true })
        for (const e of entries) {
          if (e.isDirectory()) countFiles(path.join(dir, e.name))
          else fileCount++
        }
      } catch { /* skip */ }
    }
    countFiles(folderPath)

    // 날짜 추출 (경로에서 YYYYMMDD 패턴)
    const dateMatch = folderPath.match(/(\d{4})[\\/](\d{2})[\\/](\d{2})/)
    const backupDate = dateMatch ? `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}` : undefined

    return {
      valid: true,
      db_size_mb: Math.round(dbSizeMb * 10) / 10,
      file_count: fileCount,
      backup_date: backupDate,
    }
  } catch (err) {
    return { valid: false, error: `검사 오류: ${err}` }
  }
}

/**
 * 백업에서 복원
 * 완료 후 app.relaunch() + app.quit() 으로 재시작
 */
export async function restoreFromBackup(
  backupFolder: string,
  targetBasePath?: string,
  onProgress?: (p: RestoreProgress) => void
): Promise<RestoreResult> {
  const emit = onProgress ?? (() => {})
  let dbRestored = false
  let filesRestored = 0

  try {
    emit({ phase: 'VALIDATE', message: '백업 폴더 확인 중...', percent: 5 })

    const validation = validateBackupFolder(backupFolder)
    if (!validation.valid) {
      return { success: false, error: validation.error, db_restored: false, files_restored: 0 }
    }

    const destBase = targetBasePath ?? getBasePath()

    // 대상 디렉토리 준비
    fs.mkdirSync(destBase, { recursive: true })
    fs.mkdirSync(path.join(destBase, 'database'), { recursive: true })

    // Step 1: DB 복원
    emit({ phase: 'DB', message: 'DB 복원 중...', percent: 10 })

    const srcDb  = path.join(backupFolder, 'database', 'toever_ops.db')
    const destDb = path.join(destBase, 'database', 'toever_ops.db')

    // 기존 DB가 열려있으면 닫는다
    try { closeDb() } catch { /* 이미 닫혀있거나 없으면 무시 */ }

    // DB 기존 파일 백업 (덮어쓰기 전 안전 보관)
    if (fs.existsSync(destDb)) {
      const bak = destDb + '.before-restore-' + Date.now()
      fs.copyFileSync(destDb, bak)
    }

    fs.copyFileSync(srcDb, destDb)
    dbRestored = true
    emit({ phase: 'DB', message: 'DB 복원 완료', percent: 30 })

    // Step 2: 파일 복원
    const dirMappings = [
      'raw/toever_orders',
      'raw/ezadmin_invoice',
      'generated/ezadmin_upload',
      'generated/toever_invoice_upload',
      'generated/reports',
      'pdf/contracts',
      'logs/automation',
      'logs/screenshots',
    ]

    const totalDirs = dirMappings.length
    for (let i = 0; i < totalDirs; i++) {
      const rel  = dirMappings[i]
      const src  = path.join(backupFolder, rel)
      const dest = path.join(destBase, rel)
      if (!fs.existsSync(src)) continue

      emit({
        phase: 'FILES',
        message: `${rel} 복원 중...`,
        percent: 30 + Math.round((i / totalDirs) * 60),
      })

      const result = copyDirSafe(src, dest)
      filesRestored += result.files
    }

    emit({ phase: 'DONE', message: `복원 완료: DB + ${filesRestored}개 파일`, percent: 100 })

    // settings에 경로 저장: 재시작 후 main.ts가 올바른 경로를 읽도록
    saveRestoredPath(destBase, destDb)

    return { success: true, db_restored: dbRestored, files_restored: filesRestored }
  } catch (err) {
    emit({ phase: 'ERROR', message: `복원 오류: ${err}`, percent: 0 })
    return {
      success:        false,
      error:          String(err),
      db_restored:    dbRestored,
      files_restored: filesRestored,
    }
  }
}

/** 복원된 경로를 별도 마커 파일에 저장 (DB가 닫혀 있어서 SQL 사용 불가) */
function saveRestoredPath(basePath: string, dbPath: string): void {
  try {
    const markerDir = path.join(app.getPath('userData'), 'SpringToeverOps')
    fs.mkdirSync(markerDir, { recursive: true })
    fs.writeFileSync(
      path.join(markerDir, 'restore-marker.json'),
      JSON.stringify({ storage_base_path: basePath, db_path: dbPath, restored_at: new Date().toISOString() }),
      'utf8'
    )
  } catch { /* 마커 저장 실패해도 복원에는 영향 없음 */ }
}

/** 복원 마커 파일 읽기 (main.ts 시작 시 확인) */
export function readRestoreMarker(): { storage_base_path: string } | null {
  try {
    const markerPath = path.join(app.getPath('userData'), 'SpringToeverOps', 'restore-marker.json')
    if (!fs.existsSync(markerPath)) return null
    const data = JSON.parse(fs.readFileSync(markerPath, 'utf8'))
    // 읽은 후 삭제 (1회용)
    fs.unlinkSync(markerPath)
    return data
  } catch {
    return null
  }
}

function copyDirSafe(src: string, dest: string): { files: number; bytes: number } {
  let files = 0
  let bytes = 0
  try {
    fs.mkdirSync(dest, { recursive: true })
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      const s = path.join(src, entry.name)
      const d = path.join(dest, entry.name)
      try {
        if (entry.isDirectory()) {
          const sub = copyDirSafe(s, d)
          files += sub.files
          bytes += sub.bytes
        } else {
          fs.copyFileSync(s, d)
          files++
          bytes += fs.statSync(d).size
        }
      } catch { /* 개별 파일 실패 건너뜀 */ }
    }
  } catch { /* 디렉토리 오류 건너뜀 */ }
  return { files, bytes }
}
