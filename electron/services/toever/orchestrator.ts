import path from 'path'
import fs from 'fs'
import { getDb } from '../db/schema'
import {
  createRun, updateRunStatus, getRunByIdempotencyKey, resetRunForRetry, getRunById,
  upsertOrderHeader, insertOrderItems, updateOrderStatus,
  getOrdersForEzadminExport,
  getToeverInvoiceUploadRows,
  getOrderItems, addManualReview, saveFileArtifact,
  updateOrderInvoice, invoiceEventRepo,
} from '../db/repositories'
import { filterNewShipmentTargets } from '../dedup/duplicateFilter'
import { parseToeverOrderFile, computeOrderHash } from '../parser/toeverOrderParser'
import { parseEzadminInvoiceFile } from '../parser/ezadminInvoiceParser'
import { buildEzadminUploadFile } from '../exporter/ezadminUploadBuilder'
import { buildToeverInvoiceUploadFile, buildToeverInvoiceUploadPreviewFile } from '../exporter/toeverInvoiceBuilder'
import {
  launchBrowser, closeBrowser,
  loginToever, downloadToeverOrders, uploadToeverInvoice,
} from './browser'
import { DIRS, sha256OfFile, sha256OfBuffer, saveRawFile, buildDatePrefix } from '../storage'
import { isValidOrderNo, isValidInvoiceNo, isStandardToeverOrderNo } from '../parser/safeString'
import type { CollectRound, AppRun } from '../../../shared/types'

// 단일 실행 락
const runningLocks = new Set<string>()

function acquireLock(key: string): boolean {
  if (runningLocks.has(key)) return false
  runningLocks.add(key)
  return true
}

function releaseLock(key: string): void {
  runningLocks.delete(key)
}

export function isLocked(key: string): boolean {
  return runningLocks.has(key)
}

/** prefix로 시작하는 락이 하나라도 걸려 있으면 true */
export function isAnyLocked(prefix: string): boolean {
  for (const k of runningLocks) {
    if (k.startsWith(prefix)) return true
  }
  return false
}

// ============================================================
// 주문 수집
// ============================================================

export async function collectOrders(params: {
  business_date: string
  round: CollectRound
  date_from: string
  date_to: string
  toever_id: string
  toever_password: string
  emit?: (event: string, data?: unknown) => void
}): Promise<{
  success: boolean
  collected: number
  new_targets: number
  duplicates: number
  changed_reviews: number
  skipped?: boolean
  errors: string[]
  runId?: number
}> {
  const lockKey = `collect_orders:${params.business_date}:${params.round}`
  if (!acquireLock(lockKey)) {
    return { success: false, collected: 0, new_targets: 0, duplicates: 0, changed_reviews: 0, errors: ['이미 실행 중입니다.'] }
  }

  // manual round는 매 실행마다 고유 key → 중복 방지 없이 수시 실행 가능
  // morning/afternoon(스케줄러)은 하루 1회 idempotency 유지
  const isManual = params.round === 'manual'
  const idempotencyKey = isManual
    ? `source=toever|date=${params.business_date}|round=manual|ts=${Date.now()}`
    : `source=toever|date=${params.business_date}|round=${params.round}`

  let run: AppRun
  if (!isManual) {
    const existingRun = getRunByIdempotencyKey(idempotencyKey)
    if (existingRun?.status === 'SUCCESS') {
      releaseLock(lockKey)
      return {
        success: true,
        collected: 0,
        new_targets: 0,
        duplicates: 0,
        changed_reviews: 0,
        skipped: true,
        errors: [],
        runId: existingRun.id,
      }
    }
    if (existingRun) {
      resetRunForRetry(existingRun.id)
      run = getRunById(existingRun.id)!
    } else {
      run = createRun('COLLECT_ORDERS', params.business_date, idempotencyKey, params.round)
    }
  } else {
    run = createRun('COLLECT_ORDERS', params.business_date, idempotencyKey, params.round)
  }
  params.emit?.('run:started', { runId: run.id, type: 'COLLECT_ORDERS' })

  const errors: string[] = []
  let browser_session: Awaited<ReturnType<typeof launchBrowser>> | null = null

  try {
    const downloadDir = path.join(DIRS.rawToeverOrders(), buildDatePrefix(params.business_date))
    if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir, { recursive: true })

    params.emit?.('progress', { step: '브라우저 실행 중...' })
    browser_session = await launchBrowser(downloadDir)
    const { page } = browser_session

    // 로그인
    params.emit?.('progress', { step: '투에버 로그인 중...' })
    const loginResult = await loginToever(page, params.toever_id, params.toever_password, run.id)
    if (!loginResult.success) {
      updateRunStatus(run.id, 'FAILED', undefined, 'LOGIN_FAILED', loginResult.error)
      releaseLock(lockKey)
      return { success: false, collected: 0, new_targets: 0, duplicates: 0, changed_reviews: 0, errors: [loginResult.error ?? '로그인 실패'], runId: run.id }
    }

    // 주문 다운로드
    params.emit?.('progress', { step: '주문 다운로드 중...' })
    const dlResult = await downloadToeverOrders(page, params.date_from, params.date_to, downloadDir, run.id)

    if (!dlResult.success || !dlResult.filePath) {
      updateRunStatus(run.id, 'FAILED', undefined, 'DOWNLOAD_FAILED', dlResult.error)
      releaseLock(lockKey)
      return { success: false, collected: 0, new_targets: 0, duplicates: 0, changed_reviews: 0, errors: [dlResult.error ?? '다운로드 실패'], runId: run.id }
    }

    // 원본 파일 저장
    const fileSha256 = sha256OfFile(dlResult.filePath)
    const fileStat = fs.statSync(dlResult.filePath)
    saveFileArtifact({
      artifact_type: 'TOEVER_ORDER_RAW',
      original_filename: path.basename(dlResult.filePath),
      stored_path: dlResult.filePath,
      sha256: fileSha256,
      size_bytes: fileStat.size,
      run_id: run.id,
    })

    // 파싱
    params.emit?.('progress', { step: '주문 파싱 중...' })
    const parseResult = parseToeverOrderFile(dlResult.filePath)
    errors.push(...parseResult.errors)

    if (parseResult.errors.length > 0) {
      addManualReview({
        review_type: 'HEADER_MISMATCH',
        severity: 'MEDIUM',
        run_id: run.id,
        error_message: parseResult.errors.join('\n'),
        recommended_action: '파일 헤더 및 포맷 확인',
      })
    }

    // DB 저장 + 중복 필터링
    params.emit?.('progress', { step: '중복 필터링 중...' })
    const filterResult = filterNewShipmentTargets(parseResult.rows, run.id)

    // 같은 주문번호를 가진 여러 상품 라인을 그룹화
    const orderGroups = new Map<string, typeof parseResult.rows>()
    for (const row of parseResult.rows) {
      const group = orderGroups.get(row.toever_order_no) ?? []
      group.push(row)
      orderGroups.set(row.toever_order_no, group)
    }

    // 트랜잭션으로 DB 저장
    const db = getDb()
    const saveAll = db.transaction(() => {
      for (const [orderNo, rows] of orderGroups.entries()) {
        // 주문번호 유효성 검사
        if (!isValidOrderNo(orderNo)) {
          addManualReview({
            review_type: 'INVALID_ORDER_NO',
            severity: 'HIGH',
            toever_order_no: orderNo,
            run_id: run.id,
            error_message: '유효하지 않은 주문번호',
          })
          continue
        }

        // 대표 행(첫 번째)으로 주문 헤더 구성
        const first = rows[0]

        // 모든 상품 라인을 포함한 해시 (다중 상품 주문도 정확히 감지)
        const hash = computeOrderHash({
          receiver_name: first.receiver_name,
          receiver_phone: first.receiver_phone,
          receiver_address: first.receiver_address,
          product_name: rows.map(r => `${r.product_name}/${r.option_name ?? ''}/${r.quantity}`).join('|'),
          option_name: null,
          quantity: rows.reduce((s, r) => s + r.quantity, 0),
          delivery_message: first.delivery_message,
        })

        const isNewTarget = filterResult.new_targets.some(t => t.toever_order_no === orderNo)
        const isDuplicate = filterResult.duplicates.includes(orderNo)
        const isChanged   = filterResult.changed_reviews.includes(orderNo)

        const status = isNewTarget ? 'NEW_SHIPMENT_TARGET'
          : isDuplicate  ? 'DUPLICATE_SKIPPED'
          : isChanged    ? 'ORDER_CHANGED_REVIEW'
          : 'COLLECTED'

        const { id: orderId, isNew, existingStatus } = upsertOrderHeader({
          toever_order_no: orderNo,
          toever_po_no: null,
          order_date: params.business_date,
          receiver_name: first.receiver_name,
          receiver_phone: first.receiver_phone,
          receiver_address: first.receiver_address,
          delivery_message: first.delivery_message,
          status,
          latest_invoice_no: first.invoice_no,
          latest_courier_name: first.courier_name,
          latest_invoice_input_at: null,
          ezadmin_batch_id: null,
          source_run_id: run.id,
          hash_snapshot: hash,
        })

        // 상품 라인 저장 (신규 or 변경 감지된 경우)
        const itemRows = rows.map((r, idx) => ({
          line_no: idx + 1,
          product_name: r.product_name,
          option_name: r.option_name,
          quantity: r.quantity,
          ezadmin_product_code: null,
          barcode: null,
          line_hash: computeOrderHash({
            receiver_name: r.receiver_name,
            receiver_phone: r.receiver_phone,
            receiver_address: r.receiver_address,
            product_name: r.product_name,
            option_name: r.option_name,
            quantity: r.quantity,
            delivery_message: r.delivery_message,
          }),
        }))

        if (isNew) {
          insertOrderItems(orderId, itemRows)
        } else {
          // 기존 주문 상태 보호 목록 — 이 상태인 주문은 절대 상태 강등 금지
          const PROTECTED_STATUSES: string[] = [
            'EXPORTED_TO_EZADMIN', 'INVOICE_IMPORTED', 'TOEVER_INVOICE_READY',
            'TOEVER_INVOICE_UPLOADED', 'STOREOUT_INSTRUCTED',
            'CANCELLED', 'RETURN_REQUESTED', 'ON_HOLD',
          ]

          if (isChanged) {
            // 내용 변경 감지: 상태 변경 금지 (manual_review는 filterNewShipmentTargets에서 등록됨)
            // 변경 감지는 알림 목적, 자동 재출고 또는 상태 강등 절대 불가
            // 아이템 갱신도 하지 않음 (출고 대상 아님)
          } else if (!PROTECTED_STATUSES.includes(existingStatus ?? '')) {
            // 중복/신규 처리: PROTECTED 아닌 경우에만 상태 업데이트
            // NEW_SHIPMENT_TARGET 보호: 재수집 시 DUPLICATE_SKIPPED로 강등 금지
            const NEW_TARGET_PROTECTED: string[] = ['NEW_SHIPMENT_TARGET']
            if (isDuplicate && NEW_TARGET_PROTECTED.includes(existingStatus ?? '')) {
              // 동일 내용의 NEW_SHIPMENT_TARGET → 상태 유지
            } else {
              updateOrderStatus(orderId, status)
            }
          }
        }
      }
    })
    saveAll()

    const uniqueOrders = orderGroups.size
    const summary = `수집=${uniqueOrders}건(${parseResult.rows.length}라인), 신규=${filterResult.new_targets.length}, 중복=${filterResult.duplicates.length}, 변경=${filterResult.changed_reviews.length}`
    updateRunStatus(run.id, 'SUCCESS', summary)

    params.emit?.('run:completed', { runId: run.id, summary })

    return {
      success: true,
      collected: uniqueOrders,
      new_targets: filterResult.new_targets.length,
      duplicates: filterResult.duplicates.length,
      changed_reviews: filterResult.changed_reviews.length,
      errors,
      runId: run.id,
    }
  } catch (e) {
    errors.push(String(e))
    updateRunStatus(run.id, 'FAILED', undefined, 'UNEXPECTED_ERROR', String(e))
    return { success: false, collected: 0, new_targets: 0, duplicates: 0, changed_reviews: 0, errors, runId: run.id }
  } finally {
    if (browser_session) await closeBrowser()
    releaseLock(lockKey)
  }
}

// ============================================================
// 이지어드민 업로드 파일 생성
// ============================================================

export function generateEzadminUploadFile(
  business_date: string,
  run_id?: number,
  round?: CollectRound
): { success: boolean; filePath?: string; rowCount?: number; error?: string } {
  const lockKey = `export_ezadmin:${business_date}`
  if (!acquireLock(lockKey)) {
    return { success: false, error: '이미 실행 중입니다.' }
  }

  try {
    const orders = getOrdersForEzadminExport(business_date)
    if (orders.length === 0) {
      return { success: false, error: '이지어드민 업로드 대상 주문이 없습니다.' }
    }

    const ordersWithItems = orders.map(h => ({
      header: h,
      items: getOrderItems(h.id),
    }))

    const result = buildEzadminUploadFile(ordersWithItems, business_date, run_id, round)
    return { success: true, filePath: result.filePath, rowCount: result.rowCount }
  } catch (e) {
    return { success: false, error: String(e) }
  } finally {
    releaseLock(lockKey)
  }
}

// ============================================================
// 이지어드민 송장파일 import
// ============================================================

export async function importEzadminInvoice(params: {
  filePath: string
  run_id?: number
  emit?: (event: string, data?: unknown) => void
}): Promise<{
  success: boolean
  matched: number
  multi_invoice: number
  orphan: number
  invalid_format: number
  warnings: string[]
  errors: string[]
}> {
  const lockKey = 'import_invoice'
  if (!acquireLock(lockKey)) {
    return { success: false, matched: 0, multi_invoice: 0, orphan: 0, invalid_format: 0, warnings: [], errors: ['이미 실행 중입니다.'] }
  }

  try {
    if (!fs.existsSync(params.filePath)) {
      return { success: false, matched: 0, multi_invoice: 0, orphan: 0, invalid_format: 0, warnings: [], errors: [`파일을 찾을 수 없습니다: ${params.filePath}`] }
    }
    const { rows, fileHash, warnings, errors } = parseEzadminInvoiceFile(params.filePath)

    if (errors.length > 0) {
      addManualReview({
          review_type: 'HEADER_MISMATCH',
          severity: 'HIGH',
          run_id: params.run_id,
          error_message: errors.join('\n'),
          recommended_action: '이지어드민 송장 파일 포맷 확인',
        })
      return { success: false, matched: 0, multi_invoice: 0, orphan: 0, invalid_format: 0, warnings, errors }
    }

    // 파일 hash 중복 확인
    const db = getDb()
    const existingFile = db.prepare('SELECT id FROM file_artifact WHERE sha256 = ?').get(fileHash)
    if (existingFile) {
      return {
        success: false, matched: 0, multi_invoice: 0, orphan: 0, invalid_format: 0,
        warnings,
        errors: ['이미 import된 파일입니다. (파일 hash 중복)'],
      }
    }

    // 원본 파일을 raw 저장소로 복사 (사용자 선택 파일이 삭제되어도 보존)
    const rawDir  = DIRS.rawEzadminInvoice()
    const destName = `${buildDatePrefix()}_${path.basename(params.filePath)}`
    const destPath = saveRawFile(rawDir, destName, fs.readFileSync(params.filePath))
    const fileStat = fs.statSync(destPath)
    saveFileArtifact({
      artifact_type: 'EZADMIN_INVOICE_RAW',
      original_filename: path.basename(params.filePath),
      stored_path: destPath,  // 복사된 경로 저장
      sha256: fileHash,
      size_bytes: fileStat.size,
      run_id: params.run_id ?? null,
    })

    // 주문번호 기준 그룹화
    // 투에버 정식 주문번호(숫자 19자리)가 아닌 행은 송장 import 대상에서 제외
    // (예: "_gift" 접미사가 붙은 사은품용 임시 주문번호, 길이가 다른 사내 관리 코드 등)
    const grouped = new Map<string, { invoice_nos: Set<string>; courier: string | null; input_date: string | null }>()
    let invalidFormatCount = 0
    const invalidFormatSamples = new Set<string>()

    for (const row of rows) {
      if (!row.invoice_no) continue
      if (!isValidInvoiceNo(row.invoice_no)) {
        warnings.push(`주문 ${row.order_no}: 유효하지 않은 송장번호 ${row.invoice_no}`)
        continue
      }
      if (!isStandardToeverOrderNo(row.order_no)) {
        invalidFormatCount++
        invalidFormatSamples.add(row.order_no)
        continue
      }

      const existing = grouped.get(row.order_no) ?? {
        invoice_nos: new Set<string>(),
        courier: null,
        input_date: null,
      }
      existing.invoice_nos.add(row.invoice_no)
      existing.courier = row.courier_name ?? null
      existing.input_date = row.invoice_input_date ?? null
      grouped.set(row.order_no, existing)
    }

    if (invalidFormatCount > 0) {
      const sampleList = [...invalidFormatSamples].slice(0, 5).join(', ')
      warnings.push(
        `주문번호 형식이 아닌 ${invalidFormatCount}건 제외 (정식 주문번호는 숫자 19자리) — 예: ${sampleList}`
      )
    }

    let matched = 0
    let multi_invoice = 0
    let orphan = 0

    const evRepo = invoiceEventRepo()

    for (const [order_no, data] of grouped.entries()) {
      // better-sqlite3는 동기 API - await Promise.resolve() 불필요
      const order = db.prepare('SELECT * FROM order_header WHERE toever_order_no = ?').get(order_no) as { id: number } | undefined

      if (!order) {
        orphan++
        addManualReview({
          review_type: 'ORPHAN_INVOICE',
          severity: 'MEDIUM',
          toever_order_no: order_no,
          run_id: params.run_id,
          error_message: '이지어드민 송장 파일에 있는 주문번호가 DB에 없음',
          recommended_action: '주문 수집 먼저 실행 필요',
        })
        continue
      }

      if (data.invoice_nos.size > 1) {
        multi_invoice++
      }

      const invoiceList = [...data.invoice_nos]
      let addedCount = 0
      let lastInvoice = ''

      for (const invoice_no of invoiceList) {
        // 이미 import된 송장번호는 중복으로 건너뜀 (재import 시 보존)
        const existing = db.prepare(
          'SELECT id FROM invoice_event WHERE order_id = ? AND invoice_no = ?'
        ).get(order.id, invoice_no) as { id: number } | undefined

        if (existing) continue

        evRepo.insert({
          order_id: order.id,
          source_type: 'EZADMIN_IMPORT',
          invoice_no,
          courier_name: data.courier,
          invoice_input_at: data.input_date,
          status: 'MATCHED',
          message: invoiceList.length > 1 ? '복수 송장 (분할 출고)' : null,
        })
        addedCount++
        lastInvoice = invoice_no
      }

      if (addedCount === 0) continue

      updateOrderInvoice(order.id, lastInvoice, data.courier, data.input_date)
      matched += addedCount
    }

    return { success: true, matched, multi_invoice, orphan, invalid_format: invalidFormatCount, warnings, errors }
  } finally {
    releaseLock(lockKey)
  }
}

// ============================================================
// 투에버 송장 업로드
// ============================================================

/**
 * 오늘의 일일 송장 업로드 현황 조회
 * - 대기 중인 송장 건수 + 미리보기
 * - 오늘 이미 업로드 완료됐는지 여부
 */
export function getDailyInvoiceStatus(today: string): {
  pendingCount: number
  uploadedToday: boolean
  lastUploadAt: string | null
  lastUploadCount: number
  pendingItems: { order_no: string; invoice_no: string; recipient: string }[]
} {
  const db = getDb()

  // 오늘 성공한 실제(non-dryRun) UPLOAD_TOEVER_INVOICE run 조회
  // idempotency_key가 ':dry'로 끝나는 것은 dryRun 실행이므로 제외
  const lastRun = db.prepare(`
    SELECT summary, finished_at
    FROM app_run
    WHERE run_type = 'UPLOAD_TOEVER_INVOICE'
      AND business_date = ?
      AND status = 'SUCCESS'
      AND idempotency_key NOT LIKE '%:dry'
    ORDER BY id DESC
    LIMIT 1
  `).get(today) as { summary: string | null; finished_at: string | null } | undefined

  const uploadedToday = !!lastRun

  // summary 형식: "N건 업로드 성공" — 앞 숫자만 추출 (uploaded=N)
  let lastUploadCount = 0
  if (lastRun?.summary) {
    const match = lastRun.summary.match(/^(\d+)/)
    if (match) lastUploadCount = parseInt(match[1], 10)
  }

  const rows = getToeverInvoiceUploadRows()
  const pendingItems = rows.map(r => ({
    order_no:   r.toever_order_no,
    invoice_no: r.invoice_no,
    recipient:  r.receiver_name ?? '',
  }))

  return {
    pendingCount: rows.length,
    uploadedToday,
    lastUploadAt: lastRun?.finished_at ?? null,
    lastUploadCount,
    pendingItems,
  }
}

/**
 * 송장 업로드 대상 목록만 반환 (브라우저 없음, 상태 변경 없음)
 */
export function previewToeverInvoiceUpload(): {
  order_no: string
  invoice_no: string
  recipient: string
}[] {
  return getToeverInvoiceUploadRows().map(r => ({
    order_no:   r.toever_order_no,
    invoice_no: r.invoice_no,
    recipient:  r.receiver_name ?? '',
  }))
}

/** 실제 업로드 xls 파일 생성 (DB/상태 변경 없음, 업로드 전 확인용) */
export function generateToeverInvoiceUploadPreview(): {
  filePath: string
  rowCount: number
  rows: Array<{ order_no: string; invoice_no: string; recipient: string }>
} {
  const uploadRows = getToeverInvoiceUploadRows()
  if (uploadRows.length === 0) {
    throw new Error('투에버 송장 업로드 대상 주문이 없습니다.')
  }
  const preview = buildToeverInvoiceUploadPreviewFile(uploadRows)
  const recipientByKey = new Map(
    uploadRows.map(r => [`${r.toever_order_no}|${r.invoice_no}`, r.receiver_name ?? ''])
  )
  return {
    ...preview,
    rows: preview.rows.map(r => ({
      ...r,
      recipient: recipientByKey.get(`${r.order_no}|${r.invoice_no}`) ?? '',
    })),
  }
}

export async function uploadToeverInvoiceFile(params: {
  toever_id: string
  toever_password: string
  run_id?: number
  /** true = 파일 생성까지만, uploadBtn 클릭 안 함 */
  dryRun?: boolean
  emit?: (event: string, data?: unknown) => void
}): Promise<{
  success: boolean
  dryRun?: boolean
  uploaded: number
  failed: number
  errors: string[]
}> {
  const lockKey = 'upload_toever_invoice'
  if (!acquireLock(lockKey)) {
    return { success: false, uploaded: 0, failed: 0, errors: ['이미 실행 중입니다.'] }
  }

  const errors: string[] = []

  try {
    const rows = getToeverInvoiceUploadRows()
    if (rows.length === 0) {
      return { success: false, uploaded: 0, failed: 0, errors: ['투에버 송장 업로드 대상 주문이 없습니다.'] }
    }

    // 업로드 파일 생성
    params.emit?.('progress', { step: '투에버 송장 업로드 파일 생성 중...' })
    const { filePath } = buildToeverInvoiceUploadFile(rows, params.run_id)

    // 브라우저 실행
    params.emit?.('progress', { step: '브라우저 실행 중...' })
    const session = await launchBrowser(DIRS.generatedToeverInvoiceUpload())
    const { page } = session

    try {
      // 로그인
      params.emit?.('progress', { step: '투에버 로그인 중...' })
      const loginResult = await loginToever(page, params.toever_id, params.toever_password, params.run_id)
      if (!loginResult.success) {
        return { success: false, uploaded: 0, failed: rows.length, errors: [loginResult.error ?? '로그인 실패'] }
      }

      // 송장 파일 업로드
      params.emit?.('progress', { step: params.dryRun ? '[DRY-RUN] 파일 첨부 확인 중...' : '송장 파일 업로드 중...' })
      const uploadResult = await uploadToeverInvoice(page, filePath, params.run_id, params.dryRun ?? false)

      // Dry-run: 파일 첨부 확인만, 상태 변경 없음
      if (uploadResult.dryRun) {
        return { success: true, dryRun: true, uploaded: 0, failed: 0, errors: [] }
      }

      if (!uploadResult.success) {
        // 결과 불명확 포함 — 자동 재시도 금지, 수동검토 등록
        addManualReview({
          review_type: 'UPLOAD_PARTIAL_FAIL',
          severity: 'HIGH',
          run_id: params.run_id,
          error_message: uploadResult.error,
          recommended_action: '수동으로 투에버 송장 업로드 페이지에서 재시도',
        })
        return { success: false, uploaded: 0, failed: rows.length, errors: [uploadResult.error ?? '업로드 실패'] }
      }

      // 성공 - 상태 변경
      const db = getDb()
      const uniqueOrderIds = [...new Set(rows.map(r => r.order_id))]
      const updateAll = db.transaction(() => {
        for (const orderId of uniqueOrderIds) {
          updateOrderStatus(orderId, 'TOEVER_INVOICE_UPLOADED')
        }
      })
      updateAll()

      return { success: true, uploaded: rows.length, failed: 0, errors }
    } finally {
      await closeBrowser()
    }
  } catch (e) {
    errors.push(String(e))
    return { success: false, uploaded: 0, failed: 0, errors }
  } finally {
    releaseLock(lockKey)
  }
}
