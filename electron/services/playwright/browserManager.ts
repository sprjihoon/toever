/**
 * Playwright Chromium 브라우저 관리
 *
 * 패키징된 앱에서도 동작하도록:
 * - PLAYWRIGHT_BROWSERS_PATH를 userData/browsers로 설정
 * - 자동화 첫 실행 전 Chromium 존재 여부 확인
 * - 없으면 자동 다운로드 (진행 콜백 지원)
 */

import { app } from 'electron'
import path from 'path'
import fs from 'fs'
import { execFile, spawn } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

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

    // 실제 실행 파일 존재 여부까지 확인
    const base = path.join(browsersPath, chromiumDir)
    const candidates = [
      path.join(base, 'chrome-win', 'chrome.exe'),      // Windows
      path.join(base, 'chrome-linux', 'chrome'),         // Linux
      path.join(base, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'), // macOS
    ]
    return candidates.some(p => fs.existsSync(p))
  } catch {
    return false
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
 * @param onProgress 진행 상황 콜백 (UI에 표시용)
 */
export async function installChromium(
  onProgress?: (p: ChromiumInstallProgress) => void
): Promise<{ success: boolean; error?: string }> {
  const emit = onProgress ?? (() => {})

  emit({ percent: 0, message: 'Chromium 다운로드 준비 중...', done: false })

  try {
    // playwright CLI를 npx로 실행 (패키징 환경에서도 node_modules에 있음)
    const playwrightBin = resolvePlaywrightCli()

    await new Promise<void>((resolve, reject) => {
      // 패키징 환경에서 process.execPath는 electron.exe이므로
      // ELECTRON_RUN_AS_NODE=1 플래그로 Node 모드로 실행
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

/** 패키징/개발 환경 모두에서 playwright CLI 경로 해결 */
function resolvePlaywrightCli(): string {
  // asar 언팩 경로 기준으로 탐색
  const candidates = [
    path.join(__dirname, '../../node_modules/playwright/cli.js'),
    path.join(process.resourcesPath ?? '', 'app.asar.unpacked/node_modules/playwright/cli.js'),
    path.join(app.getAppPath(), 'node_modules/playwright/cli.js'),
    require.resolve('playwright/lib/cli').replace(/\\/g, '/'),
  ]
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c
    } catch { /* skip */ }
  }
  // fallback: require.resolve
  return require.resolve('playwright/lib/cli')
}
