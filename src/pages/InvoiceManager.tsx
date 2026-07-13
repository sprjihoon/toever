import { useState, useEffect, useCallback } from 'react'
import type { ReactNode } from 'react'

interface StepResult {
  success: boolean
  message: string
  data?: unknown
}

interface PendingItem {
  order_no: string
  invoice_no: string
  recipient: string
}

interface DailyStatus {
  pendingCount: number
  uploadedToday: boolean
  lastUploadAt: string | null
  lastUploadCount: number
  pendingItems: PendingItem[]
}

type UploadPhase = 'idle' | 'preview' | 'confirming' | 'uploading' | 'done'

function formatKSTTime(isoString: string | null): string {
  if (!isoString) return '-'
  try {
    const d = new Date(isoString)
    return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Seoul' })
  } catch {
    return isoString
  }
}

export default function InvoiceManager() {
  const [dailyStatus, setDailyStatus] = useState<DailyStatus | null>(null)
  const [statusLoading, setStatusLoading] = useState(true)

  const [step1Result, setStep1Result] = useState<StepResult | null>(null)
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [running, setRunning] = useState<string | null>(null)

  const [uploadPhase, setUploadPhase] = useState<UploadPhase>('idle')
  const [uploadResult, setUploadResult] = useState<StepResult | null>(null)

  const loadDailyStatus = useCallback(async () => {
    const api = window.toeverApi
    if (!api) return
    setStatusLoading(true)
    try {
      const res = await api.invoice.getDailyStatus()
      if (res.success && res.data) {
        setDailyStatus(res.data as DailyStatus)
      }
    } finally {
      setStatusLoading(false)
    }
  }, [])

  useEffect(() => {
    loadDailyStatus()
  }, [loadDailyStatus])

  const handleSelectFile = async () => {
    const api = window.toeverApi
    if (!api) return
    const result = await api.invoice.selectFile()
    if (result.success && result.data) {
      setSelectedFile(result.data as string)
    }
  }

  const handleImportInvoice = async () => {
    const api = window.toeverApi
    if (!api || !selectedFile) return
    setRunning('import')
    setStep1Result(null)
    try {
      const result = await api.invoice.importEzadmin({ file_path: selectedFile })
      if (result.success && result.data) {
        const d = result.data as { matched: number; multi_invoice: number; orphan: number; warnings: string[] }
        setStep1Result({
          success: true,
          message: `매칭 완료: ${d.matched}건 / 복수송장 ${d.multi_invoice}건 / 미매칭 ${d.orphan}건`,
          data: d,
        })
        // 가져온 후 일일 현황 갱신
        await loadDailyStatus()
        // 업로드 단계를 초기화해 새 항목이 반영되도록
        setUploadPhase('idle')
        setUploadResult(null)
      } else {
        setStep1Result({ success: false, message: result.error ?? 'import 실패' })
      }
    } finally {
      setRunning(null)
    }
  }

  const handleShowPreview = async () => {
    await loadDailyStatus()
    setUploadPhase('preview')
    setUploadResult(null)
  }

  const handleConfirmUpload = async () => {
    setUploadPhase('uploading')
    setRunning('upload')
    try {
      const api = window.toeverApi
      if (!api) return
      const result = await api.invoice.uploadToever({ confirmed: true })
      if (result.success && result.data) {
        const d = result.data as { uploaded: number; failed: number; dryRun?: boolean }
        setUploadResult({
          success: true,
          message: d.dryRun
            ? `[DRY-RUN] 파일 첨부 확인 완료 (실제 업로드 없음)`
            : `투에버 업로드 완료: ${d.uploaded}건 성공`,
          data: d,
        })
        setUploadPhase('done')
        await loadDailyStatus()
      } else {
        setUploadResult({ success: false, message: result.error ?? '투에버 업로드 실패' })
        setUploadPhase('done')
      }
    } finally {
      setRunning(null)
    }
  }

  const handleCancelPreview = () => {
    setUploadPhase('idle')
  }

  const handleReset = () => {
    setUploadPhase('idle')
    setUploadResult(null)
    loadDailyStatus()
  }

  function ResultBox({ result }: { result: StepResult | null }) {
    if (!result) return null
    return (
      <div style={{
        padding: '10px 14px',
        borderRadius: 8,
        background: result.success ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
        border: `1px solid ${result.success ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`,
        color: result.success ? '#86efac' : '#fca5a5',
        fontSize: 13,
        marginTop: 8,
      }}>
        {result.success ? '✓' : '✗'} {result.message}
      </div>
    )
  }

  function StepCard({ number, title, description, children }: {
    number: number
    title: string
    description: string
    children: ReactNode
  }) {
    return (
      <div className="card" style={{ position: 'relative' }}>
        <div style={{
          position: 'absolute', top: 16, left: 16,
          width: 28, height: 28, borderRadius: '50%',
          background: '#3b82f6', color: 'white',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 13, fontWeight: 700, flexShrink: 0,
        }}>
          {number}
        </div>
        <div style={{ paddingLeft: 44 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#f1f5f9', marginBottom: 4 }}>{title}</div>
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>{description}</div>
          {children}
        </div>
      </div>
    )
  }

  const pending = dailyStatus?.pendingCount ?? 0
  const uploadedToday = dailyStatus?.uploadedToday ?? false

  return (
    <div style={{ padding: 24, maxWidth: 800, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#f1f5f9' }}>송장 관리</h1>
        <p style={{ color: '#64748b', marginTop: 4, fontSize: 13 }}>
          이지어드민 송장을 가져온 뒤, 하루 한 번 투에버에 일괄 업로드합니다.
        </p>
      </div>

      {/* 오늘의 일일 업로드 현황 배너 */}
      <div style={{
        padding: '14px 18px',
        borderRadius: 10,
        background: uploadedToday
          ? 'rgba(34,197,94,0.08)'
          : pending > 0
            ? 'rgba(245,158,11,0.08)'
            : 'rgba(100,116,139,0.08)',
        border: `1px solid ${
          uploadedToday
            ? 'rgba(34,197,94,0.25)'
            : pending > 0
              ? 'rgba(245,158,11,0.25)'
              : 'rgba(100,116,139,0.2)'
        }`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ fontSize: 20 }}>
            {statusLoading ? '⏳' : uploadedToday ? '✅' : pending > 0 ? '📦' : '💤'}
          </div>
          <div>
            <div style={{
              fontSize: 14, fontWeight: 600,
              color: uploadedToday ? '#86efac' : pending > 0 ? '#fde68a' : '#94a3b8',
            }}>
              {statusLoading
                ? '현황 조회 중...'
                : uploadedToday
                  ? `오늘 업로드 완료 (${dailyStatus!.lastUploadCount}건, ${formatKSTTime(dailyStatus!.lastUploadAt)})`
                  : pending > 0
                    ? `업로드 대기 중: ${pending}건`
                    : '오늘 업로드 대기 없음'}
            </div>
            <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
              {uploadedToday && pending > 0
                ? `⚠ 오늘 이미 업로드했지만 추가로 ${pending}건 대기 중입니다.`
                : uploadedToday
                  ? '오늘 투에버 송장 업로드가 완료되었습니다.'
                  : pending > 0
                    ? '투에버에 업로드할 준비가 된 송장이 있습니다.'
                    : 'Step 1에서 이지어드민 송장을 먼저 가져오세요.'}
            </div>
          </div>
        </div>
        <button
          onClick={loadDailyStatus}
          disabled={statusLoading}
          style={{
            background: 'transparent', border: '1px solid rgba(100,116,139,0.3)',
            borderRadius: 6, padding: '4px 10px', color: '#94a3b8',
            fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap',
          }}
        >
          새로고침
        </button>
      </div>

      {/* 작업 흐름 안내 */}
      <div style={{
        padding: '10px 14px',
        background: 'rgba(59,130,246,0.08)',
        border: '1px solid rgba(59,130,246,0.2)',
        borderRadius: 8,
        fontSize: 12,
        color: '#93c5fd',
        display: 'flex',
        gap: 8,
        flexWrap: 'wrap',
        alignItems: 'center',
      }}>
        <span>이지어드민 업로드 파일 처리 완료 (수동)</span>
        <span style={{ color: '#3b82f6' }}>→</span>
        <span>Step 1: 송장 Import (여러 번 가능)</span>
        <span style={{ color: '#3b82f6' }}>→</span>
        <span style={{ fontWeight: 600 }}>Step 2: 하루 1회 일괄 업로드</span>
      </div>

      {/* Step 1: 이지어드민 송장 Import */}
      <StepCard
        number={1}
        title="이지어드민 송장파일 Import"
        description="이지어드민에서 내려받은 송장파일을 선택합니다. 하루 중 여러 번 실행 가능하며 모든 내용이 누적됩니다."
      >
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <button className="btn-secondary" onClick={handleSelectFile} disabled={running !== null}>
            파일 선택
          </button>
          {selectedFile && (
            <span style={{ color: '#86efac', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 300 }}>
              {selectedFile.split(/[/\\]/).pop()}
            </span>
          )}
        </div>
        <button
          className="btn-primary"
          onClick={handleImportInvoice}
          disabled={running !== null || !selectedFile}
        >
          {running === 'import' ? 'Import 중...' : '송장 Import 실행'}
        </button>
        <ResultBox result={step1Result} />
        {step1Result?.success &&
          (step1Result.data as { warnings?: string[] } | undefined)?.warnings != null &&
          ((step1Result.data as { warnings: string[] }).warnings).length > 0 && (
          <div style={{ marginTop: 8 }}>
            {(step1Result.data as { warnings: string[] }).warnings.map((w, i) => (
              <div key={i} style={{ color: '#fde68a', fontSize: 11 }}>⚠ {w}</div>
            ))}
          </div>
        )}
      </StepCard>

      {/* Step 2: 투에버 일일 일괄 업로드 */}
      <StepCard
        number={2}
        title="투에버 일일 일괄 업로드"
        description="누적된 모든 대기 송장을 하나의 파일로 묶어 투에버에 업로드합니다. 하루에 1번만 실행하세요."
      >
        {/* 이미 오늘 업로드 완료된 경우 경고 */}
        {uploadedToday && uploadPhase === 'idle' && (
          <div style={{
            padding: '8px 12px',
            background: 'rgba(34,197,94,0.08)',
            border: '1px solid rgba(34,197,94,0.2)',
            borderRadius: 6,
            fontSize: 12,
            color: '#86efac',
            marginBottom: 12,
          }}>
            ✅ 오늘 {formatKSTTime(dailyStatus?.lastUploadAt ?? null)} 에 {dailyStatus?.lastUploadCount}건 업로드 완료됨
            {pending > 0 && (
              <span style={{ color: '#fde68a', marginLeft: 8 }}>
                · 추가 대기 {pending}건 존재
              </span>
            )}
          </div>
        )}

        {/* 대기 없음 */}
        {pending === 0 && uploadPhase === 'idle' && !uploadedToday && (
          <div style={{
            padding: '8px 12px',
            background: 'rgba(100,116,139,0.1)',
            border: '1px solid rgba(100,116,139,0.2)',
            borderRadius: 6,
            fontSize: 12,
            color: '#94a3b8',
            marginBottom: 12,
          }}>
            대기 중인 송장이 없습니다. Step 1에서 먼저 Import 하세요.
          </div>
        )}

        {/* idle: 업로드 시작 버튼 */}
        {uploadPhase === 'idle' && (
          <button
            className="btn-primary"
            onClick={handleShowPreview}
            disabled={running !== null || pending === 0}
            style={{ background: pending > 0 ? '#a855f7' : undefined }}
          >
            {pending > 0
              ? `📋 업로드 목록 확인 (${pending}건)`
              : '대기 송장 없음'}
          </button>
        )}

        {/* preview: 목록 확인 + 업로드 확정 */}
        {uploadPhase === 'preview' && dailyStatus && (
          <div>
            <div style={{
              padding: '10px 14px',
              background: uploadedToday
                ? 'rgba(239,68,68,0.08)'
                : 'rgba(59,130,246,0.08)',
              border: `1px solid ${uploadedToday ? 'rgba(239,68,68,0.25)' : 'rgba(59,130,246,0.2)'}`,
              borderRadius: 8,
              fontSize: 12,
              color: uploadedToday ? '#fca5a5' : '#93c5fd',
              marginBottom: 12,
            }}>
              {uploadedToday
                ? `⚠ 오늘 이미 업로드했습니다. 추가 ${pending}건을 재업로드합니다.`
                : `총 ${pending}건을 하나의 파일로 묶어 투에버에 업로드합니다.`}
            </div>

            {/* 대기 송장 목록 */}
            <div style={{
              maxHeight: 220,
              overflowY: 'auto',
              border: '1px solid rgba(100,116,139,0.2)',
              borderRadius: 8,
              marginBottom: 12,
              fontSize: 12,
            }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'rgba(30,41,59,0.8)', position: 'sticky', top: 0 }}>
                    <th style={{ padding: '6px 10px', textAlign: 'left', color: '#94a3b8', fontWeight: 500 }}>주문번호</th>
                    <th style={{ padding: '6px 10px', textAlign: 'left', color: '#94a3b8', fontWeight: 500 }}>송장번호</th>
                    <th style={{ padding: '6px 10px', textAlign: 'left', color: '#94a3b8', fontWeight: 500 }}>수신인</th>
                  </tr>
                </thead>
                <tbody>
                  {dailyStatus.pendingItems.map((item, i) => (
                    <tr
                      key={item.order_no}
                      style={{
                        borderTop: '1px solid rgba(100,116,139,0.1)',
                        background: i % 2 === 0 ? 'transparent' : 'rgba(30,41,59,0.3)',
                      }}
                    >
                      <td style={{ padding: '6px 10px', color: '#cbd5e1', fontFamily: 'monospace' }}>{item.order_no}</td>
                      <td style={{ padding: '6px 10px', color: '#86efac', fontFamily: 'monospace' }}>{item.invoice_no}</td>
                      <td style={{ padding: '6px 10px', color: '#f1f5f9' }}>{item.recipient}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className="btn-primary"
                onClick={handleConfirmUpload}
                disabled={running !== null}
                style={{ background: '#a855f7' }}
              >
                {running === 'upload' ? '업로드 중...' : `✅ 확인 — ${pending}건 지금 업로드`}
              </button>
              <button
                className="btn-secondary"
                onClick={handleCancelPreview}
                disabled={running !== null}
              >
                취소
              </button>
            </div>
          </div>
        )}

        {/* uploading */}
        {uploadPhase === 'uploading' && (
          <div style={{
            padding: '16px',
            background: 'rgba(168,85,247,0.08)',
            border: '1px solid rgba(168,85,247,0.2)',
            borderRadius: 8,
            color: '#d8b4fe',
            fontSize: 13,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}>
            <span style={{ fontSize: 18 }}>⏳</span>
            Playwright 브라우저로 투에버 로그인 후 업로드 중...
          </div>
        )}

        {/* done */}
        {uploadPhase === 'done' && (
          <div>
            <ResultBox result={uploadResult} />
            <button
              className="btn-secondary"
              onClick={handleReset}
              style={{ marginTop: 10 }}
            >
              닫기
            </button>
          </div>
        )}
      </StepCard>

      {/* 주의 사항 */}
      <div className="card" style={{ border: '1px solid rgba(239,68,68,0.2)', background: 'rgba(239,68,68,0.05)' }}>
        <h3 style={{ fontSize: 13, fontWeight: 600, color: '#fca5a5', marginBottom: 8 }}>주의 사항</h3>
        <ul style={{ color: '#94a3b8', fontSize: 12, paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <li>송장 Import는 하루에 여러 번 해도 됩니다. 모두 누적됩니다.</li>
          <li>투에버 업로드는 하루에 한 번만 실행하세요. 모든 대기 송장이 하나의 파일로 묶여 올라갑니다.</li>
          <li>동일 송장파일은 중복 import되지 않습니다. (파일 hash 비교)</li>
          <li>한 주문에 여러 송장이 있으면 수동 처리가 필요합니다.</li>
          <li>DB에 없는 주문번호는 고아 송장으로 분류됩니다.</li>
        </ul>
      </div>
    </div>
  )
}
