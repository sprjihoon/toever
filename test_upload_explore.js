/**
 * 투에버 송장 업로드 기능 위치 탐색
 * 실행: TOEVER_ID=B0000117 TOEVER_PW=unit npx electron test_upload_explore.js
 *
 * - 실제 업로드 실행 없음
 * - 클릭 없음
 * - 탐색/스크린샷만
 */
'use strict'

const path = require('path')
const fs   = require('fs')
const os   = require('os')

const TOEVER_ID     = process.env.TOEVER_ID
const TOEVER_PW     = process.env.TOEVER_PW
const BROWSERS_PATH = path.join(process.env.APPDATA ?? os.homedir(), 'spring-toever-ops', 'browsers')
process.env.PLAYWRIGHT_BROWSERS_PATH = BROWSERS_PATH

const SS_DIR = path.join(__dirname, 'screenshots')
if (!fs.existsSync(SS_DIR)) fs.mkdirSync(SS_DIR, { recursive: true })

const TOEVER_BASE    = 'https://support.toever.co.kr'
const ORDER_LIST_URL = `${TOEVER_BASE}/VendorMgr/PoState/orderDtlP.jsp`

const info = m => console.log(`  ℹ  ${m}`)
const section = m => console.log(`\n\x1b[1m\x1b[36m▶ ${m}\x1b[0m\x1b[0m`)

async function dumpFrameLinks(page, label) {
  const frames = page.frames()
  info(`[${label}] frame 수: ${frames.length}`)
  const result = []
  for (const f of frames) {
    try {
      const links = await f.$$eval('a', els => els.map(el => ({
        text: el.textContent?.trim()?.slice(0, 40),
        href: el.href,
        onclick: el.getAttribute('onclick')?.slice(0, 80) ?? '',
      })).filter(l => l.text || l.href))
      for (const l of links) result.push({ frame: f.name() || f.url().split('/').pop(), ...l })
    } catch {}
  }
  // 업로드/invoice 키워드 필터링
  const uploadLinks = result.filter(l =>
    /업로드|invoice|Invoice|upload|Upload/i.test(l.text + l.href + l.onclick)
  )
  info(`  업로드/invoice 관련 링크: ${uploadLinks.length}건`)
  for (const l of uploadLinks) {
    info(`    [${l.frame}] text="${l.text}" href="${l.href}" onclick="${l.onclick}"`)
  }
  return uploadLinks
}

async function main() {
  if (!TOEVER_ID || !TOEVER_PW) { console.error('TOEVER_ID/PW 필요'); process.exit(1) }

  const { chromium } = require('playwright')
  const browser = await chromium.launch({ headless: false, args: ['--no-sandbox'] })
  const ctx  = await browser.newContext({ locale: 'ko-KR', timezoneId: 'Asia/Seoul' })
  const page = await ctx.newPage()

  try {
    // ── 로그인 ───────────────────────────────────────────────────
    section('1. 로그인')
    await page.goto(TOEVER_BASE, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForTimeout(1500)
    const mf = page.frame({ name: 'mainFrm' }) ?? page
    try {
      await mf.waitForSelector('input[name="p_login_id"]', { timeout: 5000 })
      await mf.fill('input[name="p_login_id"]', TOEVER_ID)
      await mf.fill('input[name="p_password"]',  TOEVER_PW)
      await Promise.all([
        mf.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {}),
        mf.click('input[type="image"][alt="로그인"]'),
      ])
      await page.waitForTimeout(2000)
      console.log('  ✓  로그인 완료')
    } catch { console.log('  ✓  세션 재사용') }

    // ── 로그인 후 전체 메인 화면 탐색 ───────────────────────────
    section('2. 메인 화면 전체 링크 수집')
    await page.waitForTimeout(1000)
    await dumpFrameLinks(page, 'main')
    await page.screenshot({ path: path.join(SS_DIR, 'main_after_login.png'), fullPage: true })
    info('스크린샷: main_after_login.png')

    // 전체 frame 구조 출력
    for (const f of page.frames()) {
      info(`  frame: name="${f.name()}" url="${f.url()}"`)
    }

    // ── 발주내역 페이지에서 탐색 ────────────────────────────────
    section('3. 발주내역 페이지 전체 링크 탐색')
    await page.goto(ORDER_LIST_URL, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForTimeout(2500)
    await dumpFrameLinks(page, 'orderDtlP')
    await page.screenshot({ path: path.join(SS_DIR, 'order_list_page.png'), fullPage: true })

    // 발주내역 페이지의 frame 전체 URL 목록
    info('발주내역 page 내 모든 frame:')
    for (const f of page.frames()) {
      info(`  name="${f.name()}" url="${f.url()}"`)
    }

    // ── orderDtlP frame 내 모든 href 수집 ───────────────────────
    section('4. orderDtlP frame 내 전체 anchor 수집')
    const mainFrm = page.frame({ name: 'mainFrm' }) ?? page.frames().find(f => f.url().includes('orderDtlP')) ?? page
    info(`메인 frame: ${mainFrm.url()}`)

    try {
      const allLinks = await mainFrm.$$eval('a', els => els.map(el => ({
        text: el.textContent?.trim().slice(0, 40),
        href: el.href,
        onclick: el.getAttribute('onclick')?.slice(0, 100) ?? '',
      })))
      info(`전체 link 수: ${allLinks.length}`)
      for (const l of allLinks) {
        info(`  text="${l.text}" href="${l.href}" onclick="${l.onclick}"`)
      }
    } catch(e) { info(`link 수집 오류: ${e.message}`) }

    // ── 페이지 내 모든 form action 수집 ─────────────────────────
    section('5. form action 목록 수집')
    for (const f of page.frames()) {
      try {
        const forms = await f.$$eval('form', fls => fls.map(fm => ({
          id:     fm.id,
          action: fm.action,
          method: fm.method,
        })))
        if (forms.length > 0) {
          info(`frame "${f.name() || f.url().split('/').pop()}" forms:`)
          for (const fm of forms) info(`  id="${fm.id}" action="${fm.action}" method="${fm.method}"`)
        }
      } catch {}
    }

    // ── VendorMgr 메인 탐색 ─────────────────────────────────────
    section('6. VendorMgr 메인 페이지 탐색')
    await page.goto(`${TOEVER_BASE}/VendorMgr/main.jsp`, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {})
    await page.waitForTimeout(2000)
    info(`URL: ${page.url()}`)
    await dumpFrameLinks(page, 'VendorMgr_main')
    await page.screenshot({ path: path.join(SS_DIR, 'vendor_main.png'), fullPage: true })

    // 전체 frame URL
    for (const f of page.frames()) info(`  frame: "${f.name()}" ${f.url()}`)

    // ── 좌측 메뉴 frame 탐색 ────────────────────────────────────
    section('7. 좌측 메뉴 frame 탐색')
    const menuFrame = page.frames().find(f =>
      f.name().includes('menu') || f.url().includes('menu') || f.url().includes('left') || f.url().includes('Left')
    )
    if (menuFrame) {
      info(`메뉴 frame: ${menuFrame.url()}`)
      const menuLinks = await menuFrame.$$eval('a', els =>
        els.map(el => ({ text: el.textContent?.trim(), href: el.href, onclick: el.getAttribute('onclick') ?? '' }))
      ).catch(() => [])
      info(`메뉴 링크 수: ${menuLinks.length}`)
      for (const m of menuLinks) info(`  text="${m.text}" href="${m.href}" onclick="${m.onclick.slice(0,60)}"`)
    } else {
      info('메뉴 frame 없음')
    }

    // ── 후보 URL 접근 테스트 ─────────────────────────────────────
    section('8. 후보 업로드 URL 접근 테스트')
    const candidates = [
      `${TOEVER_BASE}/VendorMgr/PoState/uploadInvoice.jsp`,
      `${TOEVER_BASE}/VendorMgr/postate/uploadInvoice.jsp`,
      `${TOEVER_BASE}/VendorMgr/PoState/InvoiceUpload.jsp`,
      `${TOEVER_BASE}/VendorMgr/PoState/invoiceUpload.jsp`,
      `${TOEVER_BASE}/VendorMgr/invoice/upload.jsp`,
    ]
    for (const url of candidates) {
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 8000 })
        await page.waitForTimeout(500)
        const body = await page.content()
        const has404 = body.includes('죄송') || body.includes('찾을 수 없') || body.includes('404')
        const hasForm = body.includes('<form') || body.includes('uploadFile') || body.includes('UPLOAD_TOKEN')
        info(`${url.replace(TOEVER_BASE, '')} → ${has404 ? '❌ 404' : hasForm ? '✅ form 있음' : '⚠ 페이지 있으나 form 없음'}`)
        if (hasForm) {
          await page.screenshot({ path: path.join(SS_DIR, `upload_found_${Date.now()}.png`), fullPage: true })
          info('  → 스크린샷 저장됨')
        }
      } catch(e) { info(`${url} → 오류: ${e.message.slice(0, 60)}`) }
    }

  } finally {
    await page.close().catch(() => {})
    await ctx.close().catch(() => {})
    await browser.close().catch(() => {})
    console.log('\n  ✓  브라우저 종료')
  }
  console.log('\n탐색 완료\n')
  process.exit(0)
}

main().catch(e => { console.error('[FATAL]', e.message); process.exit(1) })
