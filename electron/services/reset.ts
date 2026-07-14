/**
 * 전체 데이터 초기화 서비스
 *
 * - DB(toever_ops.db, WAL/SHM 포함) 완전 삭제 후 빈 스키마로 재생성
 * - raw/ (원본 업로드 파일), generated/ (생성된 파일), pdf/, logs/, backup_temp/ 전체 삭제
 * - 설정(투에버 계정 등)도 함께 초기화됨 — 앱을 처음 설치한 상태로 되돌림
 * - 되돌릴 수 없음. 실행 후 앱 재시작 필요 (호출 측에서 app:relaunch 호출)
 */

import fs from 'fs'
import path from 'path'
import { closeDb, initDb } from './db/schema'
import { getBasePath, ensureAllDirs } from './storage'

export interface ResetResult {
  success: boolean
  deletedFiles: number
}

function removeDirContents(dir: string): number {
  let count = 0
  if (!fs.existsSync(dir)) return 0
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    try {
      if (entry.isDirectory()) {
        count += removeDirContents(full)
        fs.rmdirSync(full)
      } else {
        fs.unlinkSync(full)
        count++
      }
    } catch {
      // 개별 파일/폴더 삭제 실패는 건너뜀 (다른 프로세스가 잠금 중일 수 있음)
    }
  }
  return count
}

export function resetAllData(): ResetResult {
  const basePath = getBasePath()
  if (!basePath) throw new Error('저장소 경로가 설정되지 않았습니다.')

  let deletedFiles = 0

  // 1) DB 연결 종료 (파일 잠금 해제)
  try { closeDb() } catch { /* 이미 닫혀있으면 무시 */ }

  // 2) DB 파일 삭제 (WAL/SHM 포함)
  const dbDir = path.join(basePath, 'database')
  for (const suffix of ['', '-wal', '-shm']) {
    const p = path.join(dbDir, `toever_ops.db${suffix}`)
    if (fs.existsSync(p)) {
      fs.unlinkSync(p)
      deletedFiles++
    }
  }

  // 3) 생성/업로드/원본/로그/백업임시 폴더 전체 삭제
  const dirsToWipe = ['raw', 'generated', 'pdf', 'logs', 'backup_temp']
  for (const rel of dirsToWipe) {
    deletedFiles += removeDirContents(path.join(basePath, rel))
  }

  // 4) 빈 DB 재생성 (스키마만) + 디렉토리 재생성
  initDb(basePath)
  ensureAllDirs()

  return { success: true, deletedFiles }
}
