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
          message: `?? ??: ${d.matched}? / ???? ${d.multi_invoice}? / ??? ${d.orphan}?`,
          data: d,
        })
      } else {
        setStep1Result({ success: false, message: result.error ?? 'import ??' })
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
          message: `??? ???: ${d.uploaded}? ?? / ${d.failed}? ??`,
          data: d,
        })
      } else {
        setStep2Result({ success: false, message: result.error ?? '??? ??' })
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
        {result.success ? '?' : '?'} {result.message}
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
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#f1f5f9' }}>?? ??</h1>
        <p style={{ color: '#64748b', marginTop: 4, fontSize: 13 }}>
          ????? ?? ??? import?? ???? ??? ??????.
        </p>
      </div>

      {/* ?? ?? ?? */}
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
        <span>????? ?? ?? ?? ? (?? ??)</span>
        <span style={{ color: '#3b82f6' }}>?</span>
        <span>Step 1: ?? import + ?? ??</span>
        <span style={{ color: '#3b82f6' }}>?</span>
        <span>Step 2: ??? ?? ?? ???</span>
      </div>

      {/* Step 1: ????? ?? import */}
      <StepCard
        number={1}
        title="????? ?? ?? Import"
        description="??????? ????? ?????? ??? ?????. ????? ?? ?? ? DB? ?????."
      >
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <button className="btn-secondary" onClick={handleSelectFile} disabled={running !== null}>
            ?? ??
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
          {running === 'import' ? 'Import ?...' : '?? Import ??'}
        </button>
        <ResultBox result={step1Result} />

        {/* ?? ??? ?? */}
        {step1Result?.success && (step1Result.data as { warnings?: string[] } | undefined)?.warnings != null &&
          ((step1Result.data as { warnings: string[] }).warnings).length > 0 && (
          <div style={{ marginTop: 8 }}>
            {(step1Result.data as { warnings: string[] }).warnings.map((w, i) => (
              <div key={i} style={{ color: '#fde68a', fontSize: 11 }}>? {w}</div>
            ))}
          </div>
        )}
      </StepCard>

      {/* Step 2: ??? ?? ??? */}
      <StepCard
        number={2}
        title="??? ?? ?? ???"
        description="Import? ?? ??? upload_form.xls ??? ???? ???? ?? ??????. Playwright ????? ?????."
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
          ? ???? ?? ???? ?????. Step 1? ??? ?? ?????.
        </div>
        <button
          className="btn-primary"
          onClick={handleUploadToever}
          disabled={running !== null}
          style={{ background: '#a855f7' }}
        >
          {running === 'upload' ? '??? ?...' : '??? ?? ?? ??? ??'}
        </button>
        <ResultBox result={step2Result} />
      </StepCard>

      {/* ?? ?? */}
      <div className="card" style={{ border: '1px solid rgba(239,68,68,0.2)', background: 'rgba(239,68,68,0.05)' }}>
        <h3 style={{ fontSize: 13, fontWeight: 600, color: '#fca5a5', marginBottom: 8 }}>?? ??</h3>
        <ul style={{ color: '#94a3b8', fontSize: 12, paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <li>?? ??? ?? import?? ?????. (?? hash ??)</li>
          <li>? ??? ????? 2? ???? ???? ?? ?????.</li>
          <li>DB? ?? ????? ??? ???? ?? ?????.</li>
          <li>??? ???? ?? ? ?? 1? ??????.</li>
        </ul>
      </div>
    </div>
  )
}
