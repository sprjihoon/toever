import { useState, useEffect, useCallback } from 'react'
import type { BackupProgress, BackupHistory, RunningAutomation } from '../../shared/types'

interface BackupStatus {
  running_automations: RunningAutomation[]
  storage_ok: boolean
  backup_path_ok: boolean
  backup_path: string
  last_backup: BackupHistory | null
}

interface Props {
  onClose: () => void
  onComplete: () => void
}

type Phase = 'CHECK' | 'CONFIRM' | 'RUNNING' | 'DONE' | 'ERROR'

export default function BackupModal({ onClose, onComplete }: Props) {
  const [phase, setPhase]               = useState<Phase>('CHECK')
  const [status, setStatus]             = useState<BackupStatus | null>(null)
  const [loading, setLoading]           = useState(true)
  const [progress, setProgress]         = useState<BackupProgress | null>(null)
  const [progressLog, setProgressLog]   = useState<string[]>([])
  const [result, setResult]             = useState<{ success: boolean; data?: unknown; error?: string } | null>(null)
  const [history, setHistory]           = useState<BackupHistory[]>([])

  const addLog = useCallback((msg: string) => {
    setProgressLog(prev => [...prev, `[${new Date().toLocaleTimeString('ko-KR')}] ${msg}`])
  }, [])

  // 백업 상태 확인
  useEffect(() => {
    const api = window.toeverApi
    if (!api) return

    api.backup.status().then(r => {
      if (r.success && r.data) setStatus(r.data as BackupStatus)
      setLoading(false)
      setPhase('CONFIRM')
    })

    api.backup.getHistory(10).then(r => {
      if (r.success && r.data) setHistory(r.data as BackupHistory[])
    })

    // 진행 상황 구독
    const unsub = api.backup.onProgress((p) => {
      const prog = p as BackupProgress
      setProgress(prog)
      addLog(prog.message)
    })
    return () => unsub()
  }, [addLog])

  const handleRunBackup = async () => {
    const api = window.toeverApi
    if (!api) return
    setPhase('RUNNING')
    setProgressLog([])
    addLog('백업 시작...')

    const r = await api.backup.run('MANUAL')
    setResult(r)

    if (r.success) {
      setPhase('DONE')
      onComplete()
    } else {
      setPhase('ERROR')
    }
  }

  const formatBytes = (b: number) => {
    if (b < 1024) return `${b} B`
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
    return `${(b / 1024 / 1024).toFixed(1)} MB`
  }

  const formatDate = (s: string | null) => {
    if (!s) return '-'
    return new Date(s).toLocaleString('ko-KR')
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={e => { if (e.target === e.currentTarget && phase !== 'RUNNING') onClose() }}>
      <div style={{
        background: '#1e293b', border: '1px solid #334155',
        borderRadius: 12, width: 560, maxHeight: '85vh',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {/* 헤더 */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #334155', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: '#f1f5f9' }}>지금 백업하기</h2>
          {phase !== 'RUNNING' && (
            <button onClick={onClose} style={{ background: 'none', color: '#64748b', fontSize: 18, padding: '2px 6px' }}>✕</button>
          )}
        </div>

        {/* 본문 */}
        <div style={{ flex: 1, overflow: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {loading && (
            <div style={{ color: '#64748b', textAlign: 'center', padding: 20 }}>상태 확인 중...</div>
          )}
          {!loading && phase === 'CONFIRM' && status && (
            <>
              {/* 상태 카드들 */}
              <StatusRow
                label="기본 저장소"
                ok={status.storage_ok}
                okText="접근 가능"
                failText="접근 불가 — 저장소 경로 설정 확인 필요"
              />
              <StatusRow
                label="백업 저장소"
                ok={status.backup_path_ok}
                okText={`연결됨 (${status.backup_path})`}
                failText={`연결되지 않음 — ${status.backup_path}`}
              />

              {/* 실행 중인 자동화 경고 */}
              {status.running_automations.length > 0 && (
                <div style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)' }}>
                  <div style={{ color: '#fde68a', fontWeight: 600, fontSize: 13, marginBottom: 6 }}>
                    ⚠ 진행 중인 작업이 있습니다
                  </div>
                  <ul style={{ color: '#fde68a', fontSize: 12, paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {status.running_automations.map(a => (
                      <li key={a.key}>{a.label} 실행 중</li>
                    ))}
                  </ul>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginTop: 6 }}>
                    백업은 진행되지만, 실행 중인 작업과 백업 데이터가 일치하지 않을 수 있습니다.
                  </div>
                </div>
              )}

              {/* 백업 불가 안내 */}
              {!status.backup_path_ok && (
                <div style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)' }}>
                  <div style={{ color: '#fca5a5', fontWeight: 600, fontSize: 13 }}>
                    ✗ 백업 저장소가 연결되어 있지 않습니다
                  </div>
                  <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 4 }}>
                    외장 SSD를 연결하거나 설정에서 백업 경로를 변경하세요. 업무 데이터는 영향받지 않습니다.
                  </div>
                </div>
              )}

              {/* 마지막 백업 */}
              {status.last_backup && (
                <div style={{ fontSize: 12, color: '#64748b', display: 'flex', gap: 6 }}>
                  <span>마지막 백업:</span>
                  <span style={{ color: '#94a3b8' }}>{formatDate(status.last_backup.finished_at)}</span>
                  {status.last_backup.file_count != null && (
                    <span style={{ color: '#64748b' }}>({status.last_backup.file_count}개 파일)</span>
                  )}
                </div>
              )}

              {/* 백업 내용 안내 */}
              <div className="card" style={{ fontSize: 12, color: '#94a3b8' }}>
                <div style={{ fontWeight: 600, color: '#f1f5f9', marginBottom: 6 }}>백업 대상</div>
                <ul style={{ paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <li>SQLite DB (SQLite backup API로 안전하게)</li>
                  <li>투에버 주문 원본 파일 (raw/toever_orders)</li>
                  <li>이지어드민 송장 원본 파일 (raw/ezadmin_invoice)</li>
                  <li>이지어드민 업로드 생성 파일 (generated/ezadmin_upload)</li>
                  <li>투에버 송장 업로드 생성 파일 (generated/toever_invoice_upload)</li>
                  <li>PDF, 보고서, 로그, 스크린샷</li>
                </ul>
              </div>
            </>
          )}

          {/* 진행 중 */}
          {phase === 'RUNNING' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{
                  width: 20, height: 20, borderRadius: '50%',
                  border: '3px solid #3b82f6',
                  borderTopColor: 'transparent',
                  animation: 'spin 0.8s linear infinite',
                }} />
                <span style={{ color: '#f1f5f9', fontWeight: 600 }}>백업 진행 중...</span>
              </div>
              {progress && (
                <div style={{ padding: '8px 12px', background: '#0f172a', borderRadius: 6, fontSize: 12, color: '#86efac' }}>
                  {progress.message}
                  {progress.percent != null && (
                    <span style={{ color: '#64748b', marginLeft: 8 }}>{progress.percent}%</span>
                  )}
                </div>
              )}
              <div style={{
                maxHeight: 180, overflowY: 'auto',
                background: '#0f172a', borderRadius: 6,
                padding: '8px 12px', fontSize: 11,
              }}>
                {progressLog.map((l, i) => (
                  <div key={i} style={{ color: '#64748b', lineHeight: 1.8 }}>{l}</div>
                ))}
              </div>
              <div style={{ fontSize: 11, color: '#64748b' }}>
                백업 중에는 창을 닫지 마세요.
              </div>
            </div>
          ) : null}

          {/* 완료 */}
          {phase === 'DONE' && result?.data ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ color: '#22c55e', fontSize: 16, fontWeight: 700 }}>✓ 백업 완료</div>
              <div style={{ fontSize: 13, color: '#94a3b8' }}>
                <div>파일 수: {(result.data as { file_count?: number }).file_count ?? '-'}개</div>
                <div>크기: {(result.data as { size_bytes?: number }).size_bytes != null ? formatBytes((result.data as { size_bytes: number }).size_bytes) : '-'}</div>
                <div style={{ marginTop: 4, wordBreak: 'break-all', color: '#64748b', fontSize: 11 }}>
                  저장 위치: {(result.data as { dest_path?: string }).dest_path}
                </div>
              </div>
            </div>
          ) : null}

          {/* 실패 */}
          {phase === 'ERROR' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ color: '#ef4444', fontSize: 15, fontWeight: 700 }}>✗ 백업 실패</div>
              <div style={{ padding: '8px 12px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 6, fontSize: 12, color: '#fca5a5' }}>
                {result?.error ?? '알 수 없는 오류'}
              </div>
              <div style={{ fontSize: 12, color: '#94a3b8' }}>
                업무 데이터는 변경되지 않았습니다. 수동검토 큐에서 백업 오류를 확인할 수 있습니다.
              </div>
            </div>
          )}

          {/* 백업 이력 */}
          {(phase === 'CONFIRM' || phase === 'DONE' || phase === 'ERROR') && history.length > 0 && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 6 }}>최근 백업 이력</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {history.slice(0, 5).map(h => (
                  <div key={h.id} style={{ display: 'flex', gap: 8, fontSize: 11, color: '#64748b' }}>
                    <span style={{ color: h.status === 'SUCCESS' ? '#22c55e' : h.status === 'SKIPPED' ? '#f59e0b' : '#ef4444' }}>
                      {h.status === 'SUCCESS' ? '✓' : h.status === 'SKIPPED' ? '–' : '✗'}
                    </span>
                    <span>{formatDate(h.started_at)}</span>
                    {h.file_count != null && <span>({h.file_count}개)</span>}
                    {h.error_message && <span style={{ color: '#fca5a5', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.error_message}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 하단 버튼 */}
        <div style={{ padding: '14px 20px', borderTop: '1px solid #334155', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          {phase === 'CONFIRM' && (
            <>
              <button className="btn-secondary" onClick={onClose}>취소</button>
              <button
                className="btn-primary"
                onClick={handleRunBackup}
                disabled={!status?.backup_path_ok}
                style={{ opacity: status?.backup_path_ok ? 1 : 0.4 }}
              >
                백업 시작
              </button>
            </>
          )}
          {(phase === 'DONE' || phase === 'ERROR') && (
            <button className="btn-primary" onClick={onClose}>닫기</button>
          )}
        </div>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}

function StatusRow({ label, ok, okText, failText }: {
  label: string; ok: boolean; okText: string; failText: string
}) {
  return (
    <div style={{
      display: 'flex', gap: 10, alignItems: 'flex-start',
      padding: '10px 14px', borderRadius: 8,
      background: ok ? 'rgba(34,197,94,0.07)' : 'rgba(239,68,68,0.07)',
      border: `1px solid ${ok ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.25)'}`,
    }}>
      <span style={{ fontSize: 16, lineHeight: 1 }}>{ok ? '✓' : '✗'}</span>
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: ok ? '#86efac' : '#fca5a5' }}>{label}</div>
        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{ok ? okText : failText}</div>
      </div>
    </div>
  )
}
