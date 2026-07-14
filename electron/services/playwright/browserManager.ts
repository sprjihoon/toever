/**
 * Playwright Chromium 브라우저 관리
 *
 * 환경변수(PLAYWRIGHT_BROWSERS_PATH) 방식은 Electron 패키징 환경에서 신뢰할 수 없다.
 * → executablePath를 직접 계산해서 chromium.launch()에 전달하는 방식으로 동작.
 *
 * 경로 우선순위 (패키징 환경):
 *   1. resources/browsers/chromium-X/chrome-win64/chrome.exe  (번들, extraResources)
 *   2. userData/browsers/chromium-X/chrome-win64/chrome.exe   (복사본)
 *
 * 경로 우선순위 (개발 환경):
 *   1. [프로젝트]/build-browsers/chromium-X/chrome-win64/chrome.exe
 *   2. LOCALAPPDATA/ms-playwright/chromium-X/chrome-win64/chrome.exe
 */

import { app } from 'electron'
import path from 'path'
import fs from 'fs'
import { spawn } from 'child_process'

/** 플랫폼별 chrome 실행 파일 상대 경로 후보 */
const CHROME_EXEC_SUBPATHS =
  process.platform === 'win32'
    ? ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe']
    : process.platform === 'darwin'
    ? ['chrome-mac/Chromium.app/Contents/MacOS/Chromium']
    : ['chrome-linux/chrome']

/**
 * 지정된 browsers 루트 디렉터리 안에서 Chromium 실행 파일을 찾는다.
 * 못 찾으면 null 반환.
 */
function findChromiumExecIn(browsersRoot: string): string | null {
  if (!fs.existsSync(browsersRoot)) return null
  try {
    const entries = fs.readdirSync(browsersRoot)
    const chromiumDir = entries.find(e => e.startsWith('chromium-'))
    if (!chromiumDir) return null

    const base = path.join(browsersRoot, chromiumDir)
    for (const sub of CHROME_EXEC_SUBPATHS) {
      const full = path.join(base, sub)
      if (fs.existsSync(full)) return full
    }
    return null
  } catch {
    return null
  }
}

/**
 * Chromium 실행 파일의 절대 경로를 반환한다.
 * 찾지 못하면 null 반환.
 */
export function getChromiumExecutablePath(): string | null {
  if (app.isPackaged) {
    // 1순위: 설치 패키지에 번들된 browsers (resources/browsers/)
    const bundled = path.join(process.resourcesPath ?? '', 'browsers')
    const fromBundle = findChromiumExecIn(bundled)
    if (fromBundle) return fromBundle

    // 2순위: userData/browsers (번들을 복사했거나 별도 설치)
    const userDataBrowsers = path.join(app.getPath('userData'), 'browsers')
    return findChromiumExecIn(userDataBrowsers)
  } else {
    // 개발 환경 1순위: 프로젝트 build-browsers/
    const projectBrowsers = path.join(app.getAppPath(), 'build-browsers')
    const fromProject = findChromiumExecIn(projectBrowsers)
    if (fromProject) return fromProject

    // 개발 환경 2순위: Playwright 기본 설치 경로 (ms-playwright)
    const msPlaywright =
      process.platform === 'win32'
        ? path.join(process.env.LOCALAPPDATA ?? '', 'ms-playwright')
        : path.join(process.env.HOME ?? '', '.cache', 'ms-playwright')
    return findChromiumExecIn(msPlaywright)
  }
}

/** Chromium 실행 파일이 존재하는지 확인 */
export function isChromiumInstalled(): boolean {
  return getChromiumExecutablePath() !== null
}

/**
 * 설치 패키지에 번들된 Chromium을 userData/browsers로 복사한다.
 * (패키징 환경에서 번들 경로가 읽기 전용일 경우를 대비한 fallback)
 */
export function copyBundledChromiumIfNeeded(): boolean {
  if (!app.isPackaged) return false

  const bundledBrowsersPath = path.join(process.resourcesPath ?? '', 'browsers')
  if (!fs.existsSync(bundledBrowsersPath)) return false

  // 이미 번들에서 바로 실행 가능하면 복사 불필요
  if (findChromiumExecIn(bundledBrowsersPath)) return true

  // userData로 복사
  const targetPath = path.join(app.getPath('userData'), 'browsers')
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

/**
 * Playwright 브라우저 경로 초기화 (호환성 유지용, 실제 launch는 executablePath 사용)
 * installChromium()의 온라인 다운로드 대상 경로로만 사용.
 */
export function initPlaywrightBrowserPath(): void {
  if (app.isPackaged) {
    const browsersPath = path.join(app.getPath('userData'), 'browsers')
    process.env.PLAYWRIGHT_BROWSERS_PATH = browsersPath
  }
}

/** installChromium()이 다운로드할 경로 (환경변수 또는 userData/browsers) */
function getInstallTargetPath(): string {
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) return process.env.PLAYWRIGHT_BROWSERS_PATH
  if (app.isPackaged) return path.join(app.getPath('userData'), 'browsers')
  if (process.platform === 'win32') {
    return path.join(process.env.LOCALAPPDATA ?? '', 'ms-playwright')
  }
  return path.join(process.env.HOME ?? '', '.cache', 'ms-playwright')
}

export interface ChromiumInstallProgress {
  percent: number
  message: string
  done: boolean
  error?: string
}

/**
 * Chromium을 설치한다.
 * 1) 번들 Chromium 복사 시도 (패키징 환경)
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
    const installTarget = getInstallTargetPath()

    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [playwrightBin, 'install', 'chromium'],
        {
          env: {
            ...process.env,
            ELECTRON_RUN_AS_NODE: '1',
            PLAYWRIGHT_BROWSERS_PATH: installTarget,
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
 */
function resolvePlaywrightCli(): string {
  const resourcesPath = process.resourcesPath ?? path.join(path.dirname(process.execPath), 'resources')

  const candidates = [
    path.join(resourcesPath, 'app.asar.unpacked', 'node_modules', 'playwright', 'cli.js'),
    path.join(resourcesPath, 'app.asar.unpacked', 'node_modules', 'playwright-core', 'cli.js'),
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
