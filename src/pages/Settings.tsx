import { useState, useEffect } from 'react'
import type { AppSettings } from '../../shared/types'
import FirstRunModal from '../components/FirstRunModal'

const DEFAULT_SETTINGS: AppSettings = {
  toever_id:              '',
  toever_password:        '',
  storage_base_path:      'D:\\SpringToeverOps',
  backup_path:            'E:\\SpringToeverOpsBackup',
  company_cd:             '01',
  merchant_cd:            '0001',
  entr_no:                '00117',
  scheduler_enabled:      true,
  morning_collect_time:   '10:30',
  afternoon_collect_time: '15:30',
  close_backup_time:      '17:30',
}

export default function Settings() {
  const [settings, setSettings]         = useState<AppSettings>(DEFAULT_SETTINGS)
  const [saving, setSaving]             = useState(false)
  const [saved, setSaved]               = useState(false)
  const [storageOk, setStorageOk]       = useState<boolean | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const [showRestore, setShowRestore]   = useState(false)
  const [chromiumOk, setChromiumOk]     = useState<boolean | null>(null)
  const [installingChromium, setInstallingChromium] = useState(false)
  const [chromiumLog, setChromiumLog]   = useState<string[]>([])

  useEffect(() => {
    const api = window.toeverApi
    if (!api) return
    api.settings.getAll().then(result => {
      if (result.success && result.data) {
        setSettings(result.data as AppSettings)
      }
    })
    api.playwright.isChromiumInstalled().then(r => {
      if (r.success) setChromiumOk(r.data as boolean)
    })
  }, [])

  const handleSave = async () => {
    const api = window.toeverApi
    if (!api) return
    setSaving(true)
    setSaved(false)
    try {
      const result = await api.settings.save(settings)
      if (result.success) {
        setSaved(true)
        setTimeout(() => setSaved(false), 3000)
      }
    } finally {
      setSaving(false)
    }
  }

  const handleTestStorage = async () => {
    const api = window.toeverApi
    if (!api) return
    const result = await api.fs.storageStatus()
    if (result.success && result.data != null) {
      setStorageOk(result.data as boolean)
    }
  }

  const handleInstallChromium = async () => {
    const api = window.toeverApi
    if (!api) return
    setInstallingChromium(true)
    setChromiumLog([])

    const unsub = api.playwright.onInstallProgress((p) => {
      const prog = p as { message: string; done: boolean }
      setChromiumLog(prev => [...prev, prog.message])
    })

    const r = await api.playwright.installChromium()
    unsub()
    setInstallingChromium(false)

    if (r.success) {
      setChromiumOk(true)
      setChromiumLog(prev => [...prev, '✓ Chromium 설치 완료'])
    } else {
      setChromiumLog(prev => [...prev, `✗ 오류: ${r.error}`])
    }
  }

  function FieldRow({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8' }}>{label}</label>
        {children}
        {hint && <span style={{ fontSize: 11, color: '#475569' }}>{hint}</span>}
      </div>
    )
  }

  function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
    return (
      <div className="card">
        <h2 style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9', marginBottom: 16 }}>{title}</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {children}
        </div>
      </div>
    )
  }

  const inputStyle = {
    padding: '8px 10px',
    borderRadius: 6,
    background: '#0f172a',
    border: '1px solid #334155',
    color: '#f1f5f9',
    fontSize: 13,
    width: '100%',
  }

  return (
    <div style={{ padding: 24, maxWidth: 640, display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#f1f5f9' }}>설정</h1>
        <button
          className="btn-primary"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? '저장 중...' : saved ? '✓ 저장됨' : '저장'}
        </button>
      </div>

      {/* 투에버 계정 설정 */}
      <SectionCard title="투에버 계정 설정">
        <FieldRow label="투에버 ID" hint="투에버 Support 사이트 로그인 ID를 입력하세요.">
          <input
            type="text"
            value={settings.toever_id}
            onChange={e => setSettings(s => ({ ...s, toever_id: e.target.value }))}
            style={inputStyle}
            placeholder="투에버 로그인 ID"
          />
        </FieldRow>
        <FieldRow label="비밀번호" hint="비밀번호는 Windows DPAPI로 암호화됩니다. 재시작 후 다시 입력하세요.">
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              type={showPassword ? 'text' : 'password'}
              value={settings.toever_password}
              onChange={e => setSettings(s => ({ ...s, toever_password: e.target.value }))}
              style={{ ...inputStyle, flex: 1 }}
              placeholder="투에버 비밀번호"
            />
            <button
              className="btn-secondary"
              onClick={() => setShowPassword(v => !v)}
              style={{ padding: '8px 12px', fontSize: 12 }}
            >
              {showPassword ? '숨기기' : '보기'}
            </button>
          </div>
        </FieldRow>
      </SectionCard>

      {/* 저장소 설정 */}
      <SectionCard title="저장소 설정">
        <FieldRow label="기본 저장 경로" hint="주문 파일, 송장 파일, DB 파일이 저장됩니다.">
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              type="text"
              value={settings.storage_base_path}
              onChange={e => setSettings(s => ({ ...s, storage_base_path: e.target.value }))}
              style={{ ...inputStyle, flex: 1 }}
            />
            <button className="btn-secondary" onClick={handleTestStorage} style={{ padding: '8px 12px', fontSize: 12 }}>
              확인
            </button>
          </div>
          {storageOk !== null && (
            <span style={{ fontSize: 11, color: storageOk ? '#22c55e' : '#ef4444' }}>
              {storageOk ? '✓ 경로 접근 가능' : '✗ 경로 접근 불가'}
            </span>
          )}
        </FieldRow>
        <FieldRow label="백업 저장 경로 (외장 SSD)" hint="자동/수동 백업 경로입니다. 외장 SSD 경로 권장.">
          <input
            type="text"
            value={settings.backup_path}
            onChange={e => setSettings(s => ({ ...s, backup_path: e.target.value }))}
            style={inputStyle}
          />
        </FieldRow>
      </SectionCard>

      {/* 에즈어드민 설정 */}
      <SectionCard title="에즈어드민 설정">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <FieldRow label="company_cd">
            <input type="text" value={settings.company_cd}
              onChange={e => setSettings(s => ({ ...s, company_cd: e.target.value }))}
              style={inputStyle} />
          </FieldRow>
          <FieldRow label="merchant_cd">
            <input type="text" value={settings.merchant_cd}
              onChange={e => setSettings(s => ({ ...s, merchant_cd: e.target.value }))}
              style={inputStyle} />
          </FieldRow>
          <FieldRow label="entr_no">
            <input type="text" value={settings.entr_no}
              onChange={e => setSettings(s => ({ ...s, entr_no: e.target.value }))}
              style={inputStyle} />
          </FieldRow>
        </div>
      </SectionCard>

      {/* 자동화 스케줄러 */}
      <SectionCard title="자동화 스케줄러">
        <FieldRow label="">
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={settings.scheduler_enabled}
              onChange={e => setSettings(s => ({ ...s, scheduler_enabled: e.target.checked }))}
            />
            <span style={{ fontSize: 13, color: '#f1f5f9' }}>스케줄러 활성화</span>
          </label>
        </FieldRow>
        {settings.scheduler_enabled && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <FieldRow label="오전 수집 시간" hint="기본: 10:30">
              <input type="time" value={settings.morning_collect_time}
                onChange={e => setSettings(s => ({ ...s, morning_collect_time: e.target.value }))}
                style={inputStyle} />
            </FieldRow>
            <FieldRow label="오후 수집 시간" hint="기본: 15:30">
              <input type="time" value={settings.afternoon_collect_time}
                onChange={e => setSettings(s => ({ ...s, afternoon_collect_time: e.target.value }))}
                style={inputStyle} />
            </FieldRow>
            <FieldRow label="종료 백업 시간" hint="기본: 17:30">
              <input type="time" value={settings.close_backup_time}
                onChange={e => setSettings(s => ({ ...s, close_backup_time: e.target.value }))}
                style={inputStyle} />
            </FieldRow>
          </div>
        )}
        <div style={{ fontSize: 11, color: '#475569' }}>
          스케줄러는 평일(월~금)에만 실행됩니다.
        </div>
      </SectionCard>

      {/* Playwright Chromium */}
      <SectionCard title="자동화 브라우저 (Chromium)">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 13, color: chromiumOk ? '#22c55e' : '#ef4444' }}>
            {chromiumOk === null ? '확인 중...' : chromiumOk ? '✓ Chromium 설치됨' : '✗ Chromium 미설치'}
          </span>
          {!chromiumOk && (
            <button
              className="btn-primary"
              onClick={handleInstallChromium}
              disabled={installingChromium}
              style={{ fontSize: 12 }}
            >
              {installingChromium ? '설치 중...' : 'Chromium 설치'}
            </button>
          )}
        </div>
        {chromiumLog.length > 0 && (
          <div style={{
            background: '#0f172a', borderRadius: 6, padding: 10,
            fontFamily: 'monospace', fontSize: 11, color: '#94a3b8',
            maxHeight: 120, overflowY: 'auto',
          }}>
            {chromiumLog.map((l, i) => <div key={i}>{l}</div>)}
          </div>
        )}
        <div style={{ fontSize: 11, color: '#475569' }}>
          자동화 작업(주문 수집, 송장 업로드)에 사용됩니다. 최초 설치 시 약 150MB 다운로드합니다.
        </div>
      </SectionCard>

      {/* 데이터 복원 */}
      <SectionCard title="데이터 복원">
        <div style={{ fontSize: 13, color: '#94a3b8' }}>
          다른 PC의 백업 데이터를 이 PC에 복원합니다. 외장 SSD 또는 공유폴더의 백업 폴더를 선택하세요.
        </div>
        <div style={{
          padding: '10px 14px', borderRadius: 8,
          background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)',
          fontSize: 12, color: '#fca5a5'
        }}>
          ⚠ 복원 시 현재 PC의 모든 데이터가 백업 데이터로 교체됩니다.
        </div>
        <button
          className="btn-secondary"
          onClick={() => setShowRestore(true)}
          style={{ alignSelf: 'flex-start' }}
        >
          데이터 복원 시작하기
        </button>
      </SectionCard>

      {/* 복원 모달 */}
      {showRestore && (
        <FirstRunModal onClose={() => setShowRestore(false)} />
      )}
    </div>
  )
}