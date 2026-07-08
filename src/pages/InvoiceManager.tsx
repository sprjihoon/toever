import { useState } from 'react'
import type { ReactNode } from 'react'

interface StepResult {
  success: boolean
  message: string
  data?: unknown
}

export default function InvoiceManager() {
  const [step1Result, setStep1Result] = useState<StepResult | null>(null)
  const [step2Result, setStep2Result] = useState<StepResult | null>(null)
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [running, setRunning] = useState<string | null>(null)

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
        const d = result.data as { matched: number; multi_invoice: number; orphan: number; warnings: string[]; errors: string[] }
        setStep1Result({
          success: true,
          message: `매칭 완료: ${d.matched}건 / 복수송장 ${d.multi_invoice}건 / 미매칭 ${d.orphan}건`,
          data: d,
        })
      } else {
        setStep1Result({ success: false, message: result.error ?? 'import 실패' })
      }
    } finally {
      setRunning(null)
    }
  }

  const handleUploadToever = async () => {
    const api = window.toeverApi
    if (!api) return
    setRunning('upload')
    setStep2Result(null)
    try {
      const result = await api.invoice.uploadToever()
      if (result.success && result.data) {
        const d = result.data as { uploaded: number; failed: number }
        setStep2Result({
          success: true,
          message: `투에버 업로드: ${d.uploaded}건 성공 / ${d.failed}건 실패`,
          data: d,
        })
      } else {
        setStep2Result({ success: false, message: result.error ?? '투에버 실패' })
      }
    } finally {
      setRunning(null)
    }
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

  return (
    <div style={{ padding: 24, maxWidth: 760, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#f1f5f9' }}>송장 관리</h1>
        <p style={{ color: '#64748b', marginTop: 4, fontSize: 13 }}>
          에즈어드민에서 받은 송장파일을 import하고 투에버에 업로드합니다.
        </p>
      </div>

      {/* 작업 흐름 안내 */}
      <div style={{
        padding: '12px 16px',
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
        <span>에즈어드민 업로드 파일을 에즈에서 처리 후 (수동 작업)</span>
        <span style={{ color: '#3b82f6' }}>→</span>
        <span>Step 1: 송장 import + 파일 생성</span>
        <span style={{ color: '#3b82f6' }}>→</span>
        <span>Step 2: 투에버 자동 업로드 실행</span>
      </div>

      {/* Step 1: 에즈어드민 송장 import */}
      <StepCard
        number={1}
        title="에즈어드민 송장파일 Import"
        description="에즈어드민에서 내려받은 송장파일을 선택하여 가져옵니다. 송장번호와 주문 매칭 후 DB에 저장됩니다."
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

        {/* 경고 메시지 표시 */}
        {step1Result?.success && (step1Result.data as { warnings?: string[] } | undefined)?.warnings != null &&
          ((step1Result.data as { warnings: string[] }).warnings).length > 0 && (
          <div style={{ marginTop: 8 }}>
            {(step1Result.data as { warnings: string[] }).warnings.map((w, i) => (
              <div key={i} style={{ color: '#fde68a', fontSize: 11 }}>⚠ {w}</div>
            ))}
          </div>
        )}
      </StepCard>

      {/* Step 2: 투에버 업로드 실행 */}
      <StepCard
        number={2}
        title="투에버 송장 자동 업로드"
        description="Import된 송장을 기반으로 upload_form.xls 파일을 생성하고 자동으로 업로드합니다. Playwright 브라우저를 이용합니다."
      >
        <div style={{
          padding: '8px 12px',
          background: 'rgba(245,158,11,0.1)',
          border: '1px solid rgba(245,158,11,0.2)',
          borderRadius: 6,
          fontSize: 12,
          color: '#fde68a',
          marginBottom: 12,
        }}>
          ⚠ 반드시 Step 1 작업을 먼저 완료하세요.
        </div>
        <button
          className="btn-primary"
          onClick={handleUploadToever}
          disabled={running !== null}
          style={{ background: '#a855f7' }}
        >
          {running === 'upload' ? '업로드 중...' : '투에버 송장 자동 업로드 실행'}
        </button>
        <ResultBox result={step2Result} />
      </StepCard>

      {/* 주의 사항 */}
      <div className="card" style={{ border: '1px solid rgba(239,68,68,0.2)', background: 'rgba(239,68,68,0.05)' }}>
        <h3 style={{ fontSize: 13, fontWeight: 600, color: '#fca5a5', marginBottom: 8 }}>주의 사항</h3>
        <ul style={{ color: '#94a3b8', fontSize: 12, paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <li>동일 송장은 중복 import되지 않습니다. (파일 hash 비교)</li>
          <li>한 주문에 여러 송장이 있으면 2개 이상 확인 후 수동 처리하세요.</li>
          <li>DB에 없는 주문번호는 고아 송장으로 분류 처리됩니다.</li>
          <li>업로드 오류 시 최대 재시도 1회 실행합니다.</li>
        </ul>
      </div>
    </div>
  )
}