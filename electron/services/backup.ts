/**
 * 백업 서비스
 *
 * 요구사항:
 * 1. 진행 중인 자동화 작업이 있으면 경고 표시 (업무 중단하지 않음)
 * 2. 외장 SSD 백업 경로가 없으면 중단 (업무 데이터는 보존)
 * 3. SQLite DB는 SQLite backup API로 안전하게 복사 (파일 직접 복사 금지)
 * 4. 나머지 파일들은 날짜 폴더로 복사
 * 5. 백업 이력 저장
 * 6. 실패해도 원본 데이터 변경/삭제 금지
 */

import fs from 'fs'
import path from 'path'
import { getDb } from './db/schema'
import { getAllSettings, saveBackupHistory } from './db/repositories'
import { getBasePath, DIRS } from './storage'
import { isLocked } from './toever/orchestrator'
import type { BackupProgress, BackupResult, RunningAutomation } from '../../shared/types'

// 단일 실행 락
let backupRunning = false

/**
 * 현재 실행 중인 자동화 작업 목록 반환
 */
export function getRunningAutomations(): RunningAutomation[] {
  const result: RunningAutomation[] = []
  const checks: [string, string][] = [
    ['collect_orders:', '주문 수집'],
    ['export_ezadmin:', '이지어드민 업로드 파일 생성'],
    ['import_invoice',  '이지어드민 송장 import'],
    ['upload_toever_invoice', '투에버 송장 업로드'],
    ['backup', '백업'],
  ]
  for (const [key, label] of checks) {
    if (isLocked(key)) result.push({ key, label })
  }
  return result
}

/**
 * 백업 경로 접근 가능 여부 확인
 */
export function isBackupPathAvailable(backupPath: string): boolean {
  try {
    return fs.existsSync(backupPath)
  } catch {
    return false
  }
}

export interface BackupOptions {
  backup_type: 'AUTO' | 'MANUAL'
  emit?: (progress: BackupProgress) => void
}

/**
 * 백업 실행
 *
 * @returns BackupResult - 백업 결과 (실패해도 원본 데이터 보존)
 */
export async function runBackup(options: BackupOptions): Promise<BackupResult> {
  const startedAt = new Date().toISOString()

  if (backupRunning) {
    return {
      success: false,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      error: '이미 백업이 진행 중입니다.',
    }
  }

  backupRunning = true
  const emit = options.emit ?? (() => {})

  try {
    const settings = getAllSettings()
    const srcBase   = settings['storage_base_path'] ?? getBasePath()
    const destBase  = settings['backup_path'] ?? 'E:\\SpringToeverOpsBackup'

    // Step 1: 백업 경로 확인
    emit({ phase: 'CHECK', message: '백업 경로 확인 중...' })

    if (!isBackupPathAvailable(destBase)) {
      const result: BackupResult = {
        success: false,
        skipped: true,
        skip_reason: `백업 저장소가 연결되어 있지 않습니다. (경로: ${destBase})`,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        error: `백업 저장소가 연결되어 있지 않습니다. (경로: ${destBase})`,
      }
      saveBackupHistory({
        backup_type: options.backup_type,
        source_path: srcBase,
        dest_path:   destBase,
        status:      'SKIPPED',
        error_message: result.skip_reason ?? null,
        size_bytes:  null,
        file_count:  null,
        finished_at: result.finished_at,
      })
      return result
    }

    // 날짜 폴더 생성
    const now = new Date()
    const yyyy = String(now.getFullYear())
    const mm   = String(now.getMonth() + 1).padStart(2, '0')
    const dd   = String(now.getDate()).padStart(2, '0')
    const ts   = now.toISOString().replace(/[-:T.Z]/g, '').slice(0, 17)
    const destPath = path.join(destBase, yyyy, mm, dd, ts)

    if (!fs.existsSync(destPath)) fs.mkdirSync(destPath, { recursive: true })

    let totalFiles = 0
    let totalBytes = 0

    // Step 2: SQLite DB 백업 (SQLite backup API 사용)
    emit({ phase: 'DB_SNAPSHOT', message: 'DB 안전 백업 중...' })

    const dbDestDir = path.join(destPath, 'database')
    if (!fs.existsSync(dbDestDir)) fs.mkdirSync(dbDestDir, { recursive: true })

    const dbDestPath = path.join(dbDestDir, 'toever_ops.db')

    try {
      const db = getDb()
      // better-sqlite3의 내장 backup API: WAL 모드에서도 안전한 온라인 백업
      await db.backup(dbDestPath)
      const dbStat = fs.statSync(dbDestPath)
      totalBytes += dbStat.size
      totalFiles++
      emit({ phase: 'DB_SNAPSHOT', message: `DB 백업 완료 (${(dbStat.size / 1024).toFixed(1)} KB)` })
    } catch (dbErr) {
      // DB 백업 실패해도 파일 백업은 계속
      emit({ phase: 'DB_SNAPSHOT', message: `DB 백업 오류 (파일 백업 계속): ${dbErr}` })
    }

    // Step 3: 파일 백업
    emit({ phase: 'FILES', message: '파일 복사 중...' })

    const fileDirs: Array<{ src: string; destName: string }> = [
      { src: DIRS.rawToeverOrders(),           destName: 'raw/toever_orders' },
      { src: DIRS.rawEzadminInvoice(),          destName: 'raw/ezadmin_invoice' },
      { src: DIRS.generatedEzadminUpload(),     destName: 'generated/ezadmin_upload' },
      { src: DIRS.generatedToeverInvoiceUpload(), destName: 'generated/toever_invoice_upload' },
      { src: DIRS.generatedReports(),           destName: 'generated/reports' },
      { src: DIRS.pdfContracts(),              destName: 'pdf/contracts' },
      { src: DIRS.logsAutomation(),            destName: 'logs/automation' },
      { src: DIRS.logsScreenshots(),           destName: 'logs/screenshots' },
    ]

    for (const { src, destName } of fileDirs) {
      if (!fs.existsSync(src)) continue
      const dest = path.join(destPath, destName)
      const result = copyDirSafe(src, dest)
      totalFiles += result.files
      totalBytes += result.bytes
      emit({
        phase: 'FILES',
        message: `${destName} 복사 완료 (${result.files}개)`,
        files_copied: totalFiles,
        total_bytes: totalBytes,
      })
    }

    // Step 4: 설정 파일 백업 (settings는 DB에 있으므로 별도 저장 불필요)

    emit({ phase: 'DONE', message: `백업 완료: ${totalFiles}개 파일, ${(totalBytes / 1024 / 1024).toFixed(1)} MB`, files_copied: totalFiles, total_bytes: totalBytes, percent: 100 })

    const finishedAt = new Date().toISOString()
    saveBackupHistory({
      backup_type:   options.backup_type,
      source_path:   srcBase,
      dest_path:     destPath,
      status:        'SUCCESS',
      error_message: null,
      size_bytes:    totalBytes,
      file_count:    totalFiles,
      finished_at:   finishedAt,
    })

    return {
      success:    true,
      dest_path:  destPath,
      file_count: totalFiles,
      size_bytes: totalBytes,
      started_at: startedAt,
      finished_at: finishedAt,
    }
  } catch (err) {
    const finishedAt = new Date().toISOString()
    const errorMsg   = String(err)

    emit({ phase: 'ERROR', message: `백업 실패: ${errorMsg}` })

    try {
      const settings = getAllSettings()
      saveBackupHistory({
        backup_type:   options.backup_type,
        source_path:   settings['storage_base_path'] ?? getBasePath(),
        dest_path:     '',
        status:        'FAILED',
        error_message: errorMsg,
        size_bytes:    null,
        file_count:    null,
        finished_at:   finishedAt,
      })
    } catch { /* 이력 저장 실패도 원본에 영향 없음 */ }

    return {
      success:     false,
      started_at:  startedAt,
      finished_at: finishedAt,
      error:       errorMsg,
    }
  } finally {
    backupRunning = false
  }
}

/** 디렉토리를 재귀적으로 안전하게 복사한다. 실패해도 예외를 던지지 않는다. */
function copyDirSafe(src: string, dest: string): { files: number; bytes: number } {
  let files = 0
  let bytes = 0

  try {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true })

    const entries = fs.readdirSync(src, { withFileTypes: true })
    for (const entry of entries) {
      const srcPath  = path.join(src, entry.name)
      const destPath = path.join(dest, entry.name)
      try {
        if (entry.isDirectory()) {
          const sub = copyDirSafe(srcPath, destPath)
          files += sub.files
          bytes += sub.bytes
        } else {
          fs.copyFileSync(srcPath, destPath)
          const stat = fs.statSync(destPath)
          files++
          bytes += stat.size
        }
      } catch { /* 개별 파일 실패는 건너뜀 */ }
    }
  } catch { /* 디렉토리 자체 오류도 건너뜀 */ }

  return { files, bytes }
}

export function getLastBackup() {
  const db = getDb()
  return db.prepare(
    "SELECT * FROM backup_history WHERE status='SUCCESS' ORDER BY started_at DESC LIMIT 1"
  ).get()
}

export function getBackupHistory(limit = 20) {
  const db = getDb()
  return db.prepare(
    'SELECT * FROM backup_history ORDER BY started_at DESC LIMIT ?'
  ).all(limit)
}
