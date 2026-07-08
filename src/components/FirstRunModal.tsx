/**
 * 첫 실행 / 백업 복원 모달
 *
 * 표시 조건:
 *   - DB에 주문 데이터가 없는 경우 (새 설치 or 빈 DB)
 *
 * 사용자 선택:
 *   1. 새로 시작하기 → 저장 경로 선택 → 저장 후 닫기 (경로 변경 시 재시작)
 *   2. 백업에서 복원하기 → 폴더 선택 → 복원 → 앱 재시작
 */

import { useState, useCallback, useEffect } from 'react'

interface RestoreProgress {
  phase: string
  message: string
  percent: number
}

interface RestoreValidation {
  valid: boolean
  error?: string
  db_size_mb?: number
  file_count?: number
  backup_date?: string
}

interface Props {
  onClose: () => void
}

type Step =
  | 'CHOICE'
  | 'SETUP_PATH'
  | 'SELECTING'
  | 'VALIDATING'
  | 'CONFIRM'
  | 'RESTORING'
  | 'DONE'
  | 'ERROR'

export default function FirstRunModal({ onClose }: Props) {
  const [step, setStep]               = useState<Step>('CHOICE')
  const [folderPath, setFolderPath]   = useState<string | null>(null)
  const [validation, setValidation]   = useState<RestoreValidation | null>(null)
  const [progressLog, setProgressLog] = useState<string[]>([])
  const [error, setError]             = useState<string | null>(null)
  const [relaunching, setRelaunching] = useState(false)

  // 새로 시작 - 경로 설정
  const [storagePath, setStoragePath] = useState<string>('')
  const [savingPath, setSavingPath]   = useState(false)

  const addLog = useCallback((msg: string) => {
    setProgressLog(prev => [...prev, `[${new Date().toLocaleTimeString('ko-KR')}] ${msg}`])
  }, [])

  // 기본 경로 로딩
  useEffect(() => {
    const api = window.toeverApi
    if (!api) return
    api.appControl.getDefaultStoragePath?.().then(r => {
      if (r?.success && r.data) setStoragePath(r.data as string)
    }).catch(() => {})
  }, [])

  const handleBrowseStorage = async () => {
    const api = window.toeverApi
    if (!api) return
    const r = await api.fs.selectFolder({
      title: '데이터를 저장할 폴더 선택',
      defaultPath: storagePath || undefined,
    })
    if (r.success && r.data) {
      setStoragePath(r.data as string)
    }
  }

  const handleConfirmNewStart = async () => {
    const api = window.toeverApi
    if (!api || !storagePath) {
      // 경로 없이 닫으면 그냥 완료 처리
      await api?.appControl.markSetupComplete?.()
      onClose()
      return
    }

    setSavingPath(true)
    try {
      const r = await api.settings.save({ storage_base_path: storagePath })
      // 최초 설정 완료 플래그 저장 — 재시작 후에도 모달이 다시 뜨지 않게
      await api.appControl.markSetupComplete?.()
      const d = r.data as { needsRestart?: boolean } | undefined
      if (d?.needsRestart) {
        // 경로가 기본값과 달라서 재시작 필요
        await api.appControl.relaunch()
      } else {
        onClose()
      }
    } catch {
      await api.appControl.markSetupComplete?.()
      onClose()
    } finally {
      setSavingPath(false)
    }
  }

  const handleSelectFolder = async () => {
    const api = window.toeverApi
    if (!api) return
    setStep('SELECTING')

    const r = await api.backup.selectRestoreFolder()
    if (!r.success || !r.data) {
      setStep('CHOICE')
      return
    }

    const folder = r.data as string
    setFolderPath(folder)
    setStep('VALIDATING')

    const v = await api.backup.validateRestore(folder)
    const vData = v.data as RestoreValidation
    setValidation(vData)

    if (v.success && vData?.valid) {
      setStep('CONFIRM')
    } else {
      setError(vData?.error ?? '유효하지 않은 백업 폴더입니다.')
      setStep('ERROR')
    }
  }

  const handleRestore = async () => {
    const api = window.toeverApi
    if (!api || !folderPath) return

    setStep('RESTORING')
    setProgressLog([])
    addLog('복원 시작...')

    const unsub = api.backup.onRestoreProgress((p) => {
      const prog = p as RestoreProgress
      addLog(prog.message)
    })

    try {
      const r = await api.backup.restore(folderPath)
      if (r.success) {
        addLog('복원 완료. 앱을 재시작합니다...')
        setStep('DONE')
        unsub()
        setRelaunching(true)
        setTimeout(async () => {
          await api.appControl.relaunch()
        }, 1500)
      } else {
        addLog(`복원 실패: ${r.error}`)
        setError(r.error ?? '복원 실패')
        setStep('ERROR')
        unsub()
      }
    } catch (e) {
      addLog(`오류: ${e}`)
      setError(String(e))
      setStep('ERROR')
      unsub()
    }
  }

  const overlay: React.CSSProperties = {
    position: 'fixed', inset: 0, zIndex: 2000,
    background: 'rgba(0,0,0,0.85)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  }

  const box: React.CSSProperties = {
    background: '#1e293b', border: '1px solid #334155',
    borderRadius: 14, width: 560, padding: 32,
    display: 'flex', flexDirection: 'column', gap: 20,
  }

  const inputStyle: React.CSSProperties = {
    padding: '8px 10px',
    borderRadius: 6,
    background: '#0f172a',
    border: '1px solid #334155',
    color: '#f1f5f9',
    fontSize: 13,
    flex: 1,
    minWidth: 0,
  }

  const browseBtn: React.CSSProperties = {
    padding: '8px 14px', borderRadius: 6,
    background: '#1e293b', border: '1px solid #475569',
    color: '#94a3b8', fontSize: 12, cursor: 'pointer',
    whiteSpace: 'nowrap', flexShrink: 0,
  }

  return (
    <div style={overlay}>
      <div style={box}>
        {/* 로고 / 타이틀 */}
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: '#3b82f6' }}>Spring Toever Ops</div>
          <div style={{ color: '#64748b', fontSize: 13, marginTop: 6 }}>
            {step === 'CHOICE'     && '처음 실행되었습니다. 시작 방법을 선택하세요.'}
            {step === 'SETUP_PATH' && '데이터 저장 폴더를 선택하세요.'}
            {step === 'SELECTING'  && '폴더를 선택하는 중...'}
            {step === 'VALIDATING' && '백업 폴더를 확인하는 중...'}
            {step === 'CONFIRM'    && '복원 정보를 확인하세요.'}
            {step === 'RESTORING'  && '데이터를 복원하는 중...'}
            {step === 'DONE'       && '복원 완료! 앱을 재시작합니다...'}
            {step === 'ERROR'      && '문제가 발생했습니다.'}
          </div>
        </div>

        {/* CHOICE 단계 */}
        {step === 'CHOICE' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <ChoiceCard
              title="새로 시작하기"
              description="처음부터 새로운 데이터로 시작합니다. 데이터 저장 폴더를 지정한 후 사용할 수 있습니다."
              icon="✨"
              accent="#22c55e"
              onClick={() => setStep('SETUP_PATH')}
            />
            <ChoiceCard
              title="백업에서 복원하기"
              description="기존 PC에서 백업한 데이터를 복원합니다. 외장 SSD 또는 네트워크 드라이브의 백업 폴더를 선택하세요."
              icon="📂"
              accent="#3b82f6"
              onClick={handleSelectFolder}
            />
            <div style={{ textAlign: 'center', fontSize: 11, color: '#475569' }}>
              나중에 설정 메뉴에서도 경로를 변경하거나 복원할 수 있습니다.
            </div>
          </div>
        )}

        {/* SETUP_PATH 단계 - 새로 시작 경로 선택 */}
        {step === 'SETUP_PATH' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{
              padding: '12px 16px', borderRadius: 8,
              background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)',
            }}>
              <div style={{ fontWeight: 600, color: '#f1f5f9', fontSize: 14, marginBottom: 8 }}>
                📁 데이터 저장 폴더
              </div>
              <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 12 }}>
                주문 파일, 송장 파일, 데이터베이스가 저장됩니다. 여유 공간이 충분한 폴더를 선택하세요.
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  type="text"
                  value={storagePath}
                  onChange={e => setStoragePath(e.target.value)}
                  style={inputStyle}
                  placeholder="저장 폴더 경로..."
                />
                <button style={browseBtn} onClick={handleBrowseStorage}>
                  찾아보기
                </button>
              </div>
              {storagePath && (
                <div style={{ marginTop: 8, fontSize: 11, color: '#64748b', wordBreak: 'break-all' }}>
                  {storagePath}
                </div>
              )}
            </div>

            <div style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.15)' }}>
              <div style={{ fontSize: 12, color: '#93c5fd' }}>
                💡 기본값은 내 문서 폴더입니다. 외장 드라이브나 공유 폴더도 사용 가능합니다.
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn-secondary" onClick={() => setStep('CHOICE')} style={{ flex: 1 }}>
                뒤로
              </button>
              <button
                className="btn-primary"
                onClick={handleConfirmNewStart}
                disabled={!storagePath || savingPath}
                style={{ flex: 2 }}
              >
                {savingPath ? '적용 중...' : '이 폴더로 시작하기'}
              </button>
            </div>
          </div>
        )}

        {/* VALIDATING */}
        {step === 'VALIDATING' && (
          <div style={{ color: '#64748b', textAlign: 'center', padding: 20 }}>
            <div style={{ fontSize: 24, marginBottom: 8 }}>🔍</div>
            백업 폴더 확인 중...
          </div>
        )}

        {/* CONFIRM */}
        {step === 'CONFIRM' && validation && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="card" style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)' }}>
              <div style={{ fontWeight: 600, color: '#f1f5f9', marginBottom: 10, fontSize: 14 }}>백업 정보</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <InfoItem label="백업 날짜" value={validation.backup_date ?? '-'} />
                <InfoItem label="DB 크기" value={`${validation.db_size_mb ?? 0} MB`} />
                <InfoItem label="파일 수" value={`${(validation.file_count ?? 0).toLocaleString()}개`} />
                <InfoItem label="복원 경로" value="현재 설정 경로" />
              </div>
              <div style={{ marginTop: 8, fontSize: 11, color: '#64748b', wordBreak: 'break-all' }}>
                {folderPath}
              </div>
            </div>

            <div style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.2)' }}>
              <div style={{ color: '#fde68a', fontSize: 12 }}>
                ⚠ 현재 데이터에 백업 데이터가 덮어써집니다. 복원 후 앱이 재시작됩니다.
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn-secondary" onClick={() => setStep('CHOICE')} style={{ flex: 1 }}>
                취소
              </button>
              <button className="btn-primary" onClick={handleRestore} style={{ flex: 2 }}>
                복원 시작
              </button>
            </div>
          </div>
        )}

        {/* RESTORING / DONE */}
        {(step === 'RESTORING' || step === 'DONE') && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {step === 'DONE' && (
              <div style={{ textAlign: 'center', fontSize: 40 }}>
                {relaunching ? '🔄' : '✅'}
              </div>
            )}
            <div style={{
              background: '#0f172a', borderRadius: 8, padding: 12,
              maxHeight: 200, overflowY: 'auto',
              fontFamily: 'monospace', fontSize: 11, color: '#94a3b8',
              display: 'flex', flexDirection: 'column', gap: 2,
            }}>
              {progressLog.map((line, i) => (
                <div key={i}>{line}</div>
              ))}
              {step === 'RESTORING' && <div style={{ color: '#3b82f6' }}>▌</div>}
            </div>
            {step === 'DONE' && (
              <div style={{ textAlign: 'center', color: '#86efac', fontSize: 13 }}>
                {relaunching ? '앱을 재시작하는 중...' : '복원이 완료되었습니다.'}
              </div>
            )}
          </div>
        )}

        {/* ERROR */}
        {step === 'ERROR' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ padding: '12px 16px', borderRadius: 8, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)' }}>
              <div style={{ color: '#fca5a5', fontWeight: 600, marginBottom: 4 }}>✗ 오류 발생</div>
              <div style={{ color: '#94a3b8', fontSize: 12 }}>{error}</div>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn-secondary" onClick={() => { setStep('CHOICE'); setError(null) }} style={{ flex: 1 }}>
                처음으로
              </button>
              <button className="btn-primary" onClick={handleSelectFolder} style={{ flex: 1 }}>
                다시 선택
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function ChoiceCard({
  title, description, icon, accent, onClick,
}: {
  title: string
  description: string
  icon: string
  accent: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      style={{
        textAlign: 'left', padding: 18, borderRadius: 10,
        background: `${accent}0d`, border: `1px solid ${accent}33`,
        cursor: 'pointer', transition: 'all 0.15s',
        display: 'flex', gap: 14, alignItems: 'flex-start',
        color: 'inherit', width: '100%',
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = `${accent}1a` }}
      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = `${accent}0d` }}
    >
      <div style={{ fontSize: 28, lineHeight: 1 }}>{icon}</div>
      <div>
        <div style={{ fontWeight: 700, color: '#f1f5f9', fontSize: 15, marginBottom: 4 }}>{title}</div>
        <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.5 }}>{description}</div>
      </div>
    </button>
  )
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: '#64748b' }}>{label}</div>
      <div style={{ fontSize: 13, color: '#f1f5f9', fontWeight: 500 }}>{value}</div>
    </div>
  )
}