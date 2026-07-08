import { useState, useEffect, useCallback } from 'react'
import type { DashboardStats } from '../../shared/types'
import BackupModal from '../components/BackupModal'

interface Props {
  onNavigate: (page: 'dashboard' | 'orders' | 'invoice' | 'review' | 'settings') => void
  onReviewBadgeUpdate: (count: number) => void
}

type CollectRound = 'morning' | 'afternoon' | 'manual'

interface AutomationLog {
  time: string
  message: string
  type: 'info' | 'success' | 'error' | 'progress'
}

// KST(한국 표준시) 기준 오늘 날짜 반환 - UTC toISOString()은 00:00~08:59 KST에서 전날을 반환
const todayKST = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })

export default function Dashboard({ onNavigate, onReviewBadgeUpdate }: Props) {
  const [stats, setStats]                   = useState<DashboardStats | null>(null)
  const [loading, setLoading]               = useState(true)
  const [running, setRunning]               = useState<string | null>(null)
  const [logs, setLogs]                     = useState<AutomationLog[]>([])
  const [dateFrom, setDateFrom]             = useState(todayKST())
  const [dateTo, setDateTo]                 = useState(todayKST())
  const [round, setRound]                   = useState<CollectRound>('morning')
  const [backupModalOpen, setBackupModalOpen] = useState(false)

  const addLog = useCallback((message: string, type: AutomationLog['type'] = 'info') => {
    const time = new Date().toLocaleTimeString('ko-KR')
    setLogs(prev => [{ time, message, type }, ...prev].slice(0, 100))
  }, [])

  const loadStats = useCallback(async () => {
    const api = window.toeverApi
    if (!api) return
    setLoading(true)
    try {
      const result = await api.dashboard.getStats(todayKST())
      if (result.success && result.data) {
        const data = result.data as DashboardStats
        setStats(data)
        onReviewBadgeUpdate(data.manual_review_open)
      }
    } finally {
      setLoading(false)
    }
  }, [onReviewBadgeUpdate])

  useEffect(() => {
    loadStats()
    const interval = setInterval(loadStats, 30000)

    // 자동화 이벤트 구독
    const api = window.toeverApi
    if (api) {
      const unsubscribe = api.onAutomationEvent((event, data) => {
        const d = data as { step?: string; summary?: string; runId?: number } | undefined
        if (event === 'run:started') addLog(`실행 시작 (run_id=${d?.runId})`, 'info')
        else if (event === 'progress') addLog(d?.step ?? event, 'progress')
        else if (event === 'run:completed') {
          addLog(`완료: ${d?.summary ?? '처리됨'}`, 'success')
          loadStats()
        }
      })
      return () => { clearInterval(interval); unsubscribe() }
    }
    return () => clearInterval(interval)
  }, [loadStats, addLog])

  const handleCollect = async () => {
    const api = window.toeverApi
    if (!api) { addLog('API를 사용할 수 없습니다.', 'error'); return }

    // 날짜 유효성 검사
    if (dateFrom > dateTo) {
      addLog('오류: 시작일이 종료일보다 늦습니다.', 'error')
      return
    }

    setRunning('collect')
    addLog(`주문 수집 시작 (${round}, ${dateFrom}~${dateTo})`, 'info')
    try {
      const result = await api.orders.collect({
        // business_date: 조회 시작일 기준 (dateFrom) - 업무일 기준
        business_date: dateFrom,
        round,
        date_from: dateFrom,
        date_to: dateTo,
      })
      if (result.success && result.data) {
        const d = result.data as { collected: number; new_targets: number; duplicates: number; changed_reviews: number; errors: string[] }
        addLog(`수집 완료: 총 ${d.collected}건, 신규 ${d.new_targets}건, 중복제외 ${d.duplicates}건, 변경감지 ${d.changed_reviews}건`, 'success')
        if (d.errors && d.errors.length > 0) addLog(`경고: ${d.errors.join(' | ')}`, 'error')
      } else {
        addLog(`수집 실패: ${result.error ?? '알 수 없는 오류'}`, 'error')
      }
    } finally {
      setRunning(null)
      loadStats()
    }
  }

  const handleGenerateEzadmin = async () => {
    const api = window.toeverApi
    if (!api) return
    setRunning('ezadmin')
    // 현재 KST 시간 기준: 12시 이전 = morning, 12시 이후 = afternoon
    const kstHour = new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul', hour: 'numeric', hour12: false })
    const round: 'morning' | 'afternoon' = Number(kstHour) < 12 ? 'morning' : 'afternoon'
    addLog(`이지어드민 업로드 파일 생성 시작 (${todayKST()}, ${round})`, 'info')
    try {
      const result = await api.ezadmin.generateUploadFile(todayKST(), round)
      if (result.success && result.data) {
        const d = result.data as { filePath?: string; rowCount?: number }
        addLog(`생성 완료: ${d.rowCount}행 → ${d.filePath}`, 'success')
      } else {
        addLog(`생성 실패: ${result.error ?? '알 수 없는 오류'}`, 'error')
      }
    } finally {
      setRunning(null)
      loadStats()
    }
  }

  const handleBackupOpen = () => setBackupModalOpen(true)

  const StatCard = ({ label, value, color, onClick }: {
    label: string
    value: number | string
    color?: string
    onClick?: () => void
  }) => (
    <div
      className="card"
      onClick={onClick}
      style={{
        cursor: onClick ? 'pointer' : 'default',
        transition: 'transform 0.1s',
        userSelect: 'none',
      }}
      onMouseEnter={e => { if (onClick) (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-2px)' }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = '' }}
    >
      <div style={{ color: '#64748b', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ fontSize: 28, fontWeight: 700, color: color ?? '#f1f5f9' }}>
        {loading ? '...' : value}
      </div>
    </div>
  )

  const logColor = (type: AutomationLog['type']) => {
    if (type === 'success') return '#22c55e'
    if (type === 'error') return '#ef4444'
    if (type === 'progress') return '#3b82f6'
    return '#94a3b8'
  }

  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
      {backupModalOpen && (
        <BackupModal
          onClose={() => setBackupModalOpen(false)}
          onComplete={() => { setBackupModalOpen(false); addLog('백업 완료', 'success'); loadStats() }}
        />
      )}
      {/* 헤더 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#f1f5f9' }}>대시보드</h1>
          <div style={{ color: '#64748b', fontSize: 13, marginTop: 4 }}>
            {todayKST()} 기준 현황 (KST)
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-secondary" onClick={loadStats} disabled={loading}>
            {loading ? '로딩 중...' : '새로고침'}
          </button>
          <button className="btn-secondary" onClick={handleBackupOpen}>
            지금 백업
          </button>
        </div>
      </div>

      {/* 통계 카드 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <StatCard label="오늘 수집" value={stats?.total_collected ?? 0} />
        <StatCard label="신규 출고 대상" value={stats?.new_shipment_targets ?? 0} color="#22c55e" />
        <StatCard label="이지어드민 업로드" value={stats?.exported_to_ezadmin ?? 0} color="#3b82f6" />
        <StatCard label="투에버 송장 완료" value={stats?.toever_invoice_uploaded ?? 0} color="#a855f7" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <StatCard label="중복 제외" value={stats?.duplicate_skipped ?? 0} color="#64748b" />
        <StatCard label="변경 감지" value={stats?.order_changed_review ?? 0} color="#f59e0b" />
        <StatCard label="송장 import" value={stats?.invoice_imported ?? 0} color="#06b6d4" />
        <StatCard
          label="수동검토 대기"
          value={stats?.manual_review_open ?? 0}
          color={(stats?.manual_review_open ?? 0) > 0 ? '#ef4444' : '#64748b'}
          onClick={() => onNavigate('review')}
        />
      </div>

      {/* 하단 2열 레이아웃 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* 작업 패널 */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, color: '#f1f5f9' }}>작업 실행</h2>

          {/* 주문 수집 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '12px', background: '#0f172a', borderRadius: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8' }}>주문 수집</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input
                type="date"
                value={dateFrom}
                onChange={e => setDateFrom(e.target.value)}
                style={{ flex: 1, minWidth: 120 }}
              />
              <span style={{ color: '#64748b', alignSelf: 'center' }}>~</span>
              <input
                type="date"
                value={dateTo}
                onChange={e => setDateTo(e.target.value)}
                style={{ flex: 1, minWidth: 120 }}
              />
              <select
                value={round}
                onChange={e => setRound(e.target.value as CollectRound)}
              >
                <option value="morning">오전</option>
                <option value="afternoon">오후</option>
                <option value="manual">수동</option>
              </select>
            </div>
            <button
              className="btn-primary"
              onClick={handleCollect}
              disabled={running !== null}
              style={{ alignSelf: 'flex-start' }}
            >
              {running === 'collect' ? '수집 중...' : '주문 수집 실행'}
            </button>
          </div>

          {/* 이지어드민 업로드 파일 생성 */}
          <div style={{ padding: '12px', background: '#0f172a', borderRadius: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8', marginBottom: 8 }}>이지어드민 업로드 파일</div>
            <div style={{ color: '#64748b', fontSize: 12, marginBottom: 8 }}>
              신규 출고 대상 {stats?.new_shipment_targets ?? 0}건 → 파일 생성 후 탐색기에서 열림
            </div>
            <button
              className="btn-success"
              onClick={handleGenerateEzadmin}
              disabled={running !== null || (stats?.new_shipment_targets ?? 0) === 0}
            >
              {running === 'ezadmin' ? '생성 중...' : '업로드 파일 생성'}
            </button>
          </div>

          {/* 빠른 이동 */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn-secondary" onClick={() => onNavigate('invoice')}>
              🚚 송장 처리
            </button>
            <button className="btn-secondary" onClick={() => onNavigate('orders')}>
              📦 주문 검색
            </button>
            <button className="btn-secondary" onClick={() => onNavigate('review')}>
              🔍 수동검토 ({stats?.manual_review_open ?? 0})
            </button>
          </div>

          {/* 마지막 백업 */}
          <div style={{ color: '#64748b', fontSize: 12 }}>
            마지막 백업: {stats?.last_backup_at
              ? new Date(stats.last_backup_at).toLocaleString('ko-KR')
              : '없음'
            }
          </div>
        </div>

        {/* 자동화 로그 */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ fontSize: 15, fontWeight: 600, color: '#f1f5f9' }}>작업 로그</h2>
            <button
              className="btn-secondary"
              style={{ fontSize: 11, padding: '3px 8px' }}
              onClick={() => setLogs([])}
            >
              지우기
            </button>
          </div>
          <div style={{
            flex: 1,
            overflowY: 'auto',
            maxHeight: 260,
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}>
            {logs.length === 0 ? (
              <div style={{ color: '#64748b', fontSize: 12, padding: 8 }}>로그가 없습니다.</div>
            ) : (
              logs.map((log, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, fontSize: 12 }}>
                  <span style={{ color: '#475569', flexShrink: 0 }}>{log.time}</span>
                  <span style={{ color: logColor(log.type) }}>{log.message}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* 진행 현황 바 */}
      {stats && (
        <div className="card">
          <h2 style={{ fontSize: 14, fontWeight: 600, color: '#f1f5f9', marginBottom: 12 }}>오늘 처리 현황</h2>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {[
              { label: '오전 수집', value: stats.morning_collected },
              { label: '오후 수집', value: stats.afternoon_collected },
              { label: '출고처리완료', value: stats.storeout_instructed },
              { label: '오류', value: stats.errors, color: '#ef4444' },
            ].map(item => (
              <div key={item.label} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <div style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: item.color ?? '#3b82f6',
                }} />
                <span style={{ color: '#94a3b8', fontSize: 12 }}>{item.label}:</span>
                <span style={{ color: item.color ?? '#f1f5f9', fontWeight: 600, fontSize: 13 }}>{item.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}