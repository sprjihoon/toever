/**
 * Playwright Chromium 브라우저 관리
 *
 * 패키징된 앱에서도 동작하도록:
 * - PLAYWRIGHT_BROWSERS_PATH를 userData/browsers로 설정
 * - 첫 실행 시 번들 Chromium(extraResources/browsers)을 userData로 복사
 * - 번들이 없을 때만 온라인 다운로드 시도
 */

import { app } from 'electron'
import path from 'path'
import fs from 'fs'
import { spawn } from 'child_process'

let _initialized = false

/**
 * Playwright 브라우저 경로를 userData 하위로 설정한다.
 * 앱 시작 시 반드시 호출해야 한다.
 */
export function initPlaywrightBrowserPath(): void {
  if (_initialized) return
  const browsersPath = path.join(app.getPath('userData'), 'browsers')
  process.env.PLAYWRIGHT_BROWSERS_PATH = browsersPath
  _initialized = true
}

/** Playwright가 사용할 browsers 경로 */
export function getBrowsersPath(): string {
  return process.env.PLAYWRIGHT_BROWSERS_PATH ?? path.join(app.getPath('userData'), 'browsers')
}

/** Chromium 실행 파일이 존재하는지 확인 */
export function isChromiumInstalled(): boolean {
  const browsersPath = getBrowsersPath()
  if (!fs.existsSync(browsersPath)) return false

  try {
    const entries = fs.readdirSync(browsersPath)
    const chromiumDir = entries.find(e => e.startsWith('chromium-'))
    if (!chromiumDir) return false

    const base = path.join(browsersPath, chromiumDir)
    const candidates = [
      path.join(base, 'chrome-win64', 'chrome.exe'),
      path.join(base, 'chrome-win', 'chrome.exe'),
      path.join(base, 'chrome-linux', 'chrome'),
      path.join(base, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
    ]
    return candidates.some(p => fs.existsSync(p))
  } catch {
    return false
  }
}

/**
 * 설치 패키지에 번들된 Chromium이 있으면 userData/browsers로 복사한다.
 * extraResources의 browsers/ 폴더가 있을 때만 동작한다.
 */
function copyBundledChromiumIfNeeded(): boolean {
  if (!app.isPackaged) return false

  const bundledBrowsersPath = path.join(process.resourcesPath ?? '', 'browsers')
  if (!fs.existsSync(bundledBrowsersPath)) return false

  const targetPath = getBrowsersPath()

  // 이미 설치돼 있으면 건너뜀
  if (isChromiumInstalled()) return true

  try {
    fs.mkdirSync(targetPath, { recursive: true })
    copyDirRecursive(bundledBrowsersPath, targetPath)
    console.log(`[browserManager] 번들 Chromium 복사 완료: ${targetPath}`)
    return isChromiumInstalled()
  } catch (e) {
    console.warn('[browserManager] 번들 Chromium 복사 실패:', e)
    return false
  }
}

function copyDirRecursive(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath  = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath)
    } else {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}

export interface ChromiumInstallProgress {
  percent: number
  message: string
  done: boolean
  error?: string
}

/**
 * Chromium을 설치한다.
 * 1) 번들 Chromium 복사 시도
 * 2) 실패 시 온라인 다운로드
 */
export async function installChromium(
  onProgress?: (p: ChromiumInstallProgress) => void
): Promise<{ success: boolean; error?: string }> {
  const emit = onProgress ?? (() => {})

  emit({ percent: 0, message: 'Chromium 설치 준비 중...', done: false })

  // 1. 번들 Chromium이 있으면 복사로 해결
  if (app.isPackaged) {
    emit({ percent: 10, message: '번들 Chromium 확인 중...', done: false })
    const copied = copyBundledChromiumIfNeeded()
    if (copied) {
      emit({ percent: 100, message: 'Chromium 설치 완료 (번들)', done: true })
      return { success: true }
    }
  }

  // 2. 온라인 다운로드
  emit({ percent: 10, message: 'Chromium 다운로드 준비 중...', done: false })

  try {
    const playwrightBin = resolvePlaywrightCli()

    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [playwrightBin, 'install', 'chromium'],
        {
          env: {
            ...process.env,
            ELECTRON_RUN_AS_NODE: '1',
            PLAYWRIGHT_BROWSERS_PATH: getBrowsersPath(),
          },
          windowsHide: true,
        }
      )

      let progressPct = 10
      child.stdout?.on('data', (data: Buffer) => {
        const line = data.toString().trim()
        if (line) {
          progressPct = Math.min(progressPct + 5, 90)
          emit({ percent: progressPct, message: line.slice(0, 80), done: false })
        }
      })

      child.stderr?.on('data', (data: Buffer) => {
        const line = data.toString().trim()
        if (line) {
          progressPct = Math.min(progressPct + 5, 90)
          emit({ percent: progressPct, message: line.slice(0, 80), done: false })
        }
      })

      child.on('close', code => {
        if (code === 0) resolve()
        else reject(new Error(`playwright install 종료 코드: ${code}`))
      })
      child.on('error', reject)
    })

    emit({ percent: 100, message: 'Chromium 설치 완료', done: true })
    return { success: true }
  } catch (err) {
    const msg = String(err)
    emit({ percent: 0, message: `설치 실패: ${msg}`, done: true, error: msg })
    return { success: false, error: msg }
  }
}

/**
 * require.resolve 대신 fs.existsSync로 직접 CLI 경로를 찾는다.
 * require.resolve는 package.json exports 필드 제한에 걸려 실패할 수 있음.
 */
function resolvePlaywrightCli(): string {
  const resourcesPath = process.resourcesPath ?? path.join(path.dirname(process.execPath), 'resources')

  const candidates = [
    // 패키징 환경: asarUnpack 경로
    path.join(resourcesPath, 'app.asar.unpacked', 'node_modules', 'playwright', 'cli.js'),
    path.join(resourcesPath, 'app.asar.unpacked', 'node_modules', 'playwright-core', 'cli.js'),
    // 개발 환경: 프로젝트 루트 node_modules
    path.join(app.getAppPath(), 'node_modules', 'playwright', 'cli.js'),
    path.join(app.getAppPath(), 'node_modules', 'playwright-core', 'cli.js'),
  ]

  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c
    } catch { /* skip */ }
  }

  throw new Error(
    `Playwright CLI를 찾을 수 없습니다.\n확인한 경로:\n${candidates.join('\n')}`
  )
}
