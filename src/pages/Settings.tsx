import { useState, useEffect } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { AppSettings, AppHoliday } from '../../shared/types'
import FirstRunModal from '../components/FirstRunModal'

const DEFAULT_SETTINGS: AppSettings = {
  toever_id:            '',
  toever_password:      '',
  storage_base_path:    '',
  backup_path:          '',
  scheduler_enabled:    true,
  collect_schedule:     [
    { id: 'morning', time: '10:30', label: '오전 수집' },
    { id: 'afternoon', time: '15:30', label: '오후 수집' },
  ],
  invoice_upload_time:  '16:00',
  close_backup_time:    '17:30',
  public_data_api_key:  '',
}

function makeScheduleId(): string {
  return `s${Date.now()}${Math.floor(Math.random() * 1000)}`
}

export default function Settings() {
  const [settings, setSettings]           = useState<AppSettings>(DEFAULT_SETTINGS)
  const [hasStoredPassword, setHasStoredPassword] = useState(false)
  const [passwordReadable, setPasswordReadable]   = useState(true)
  const [changingPassword, setChangingPassword]   = useState(false)
  const [saving, setSaving]               = useState(false)
  const [saved, setSaved]                 = useState(false)
  const [needsRestart, setNeedsRestart]   = useState(false)
  const [storageOk, setStorageOk]         = useState<boolean | null>(null)
  const [showPassword, setShowPassword]   = useState(false)
  const [showRestore, setShowRestore]     = useState(false)
  const [chromiumOk, setChromiumOk]       = useState<boolean | null>(null)
  const [installingChromium, setInstallingChromium] = useState(false)
  const [chromiumLog, setChromiumLog]     = useState<string[]>([])
  const [appVersion, setAppVersion]       = useState<string>('')
  const [loginTesting, setLoginTesting]   = useState(false)
  const [loginTestMsg, setLoginTestMsg]   = useState<string | null>(null)
  const [resetConfirmText, setResetConfirmText] = useState('')
  const [resetting, setResetting]         = useState(false)
  const [resetError, setResetError]       = useState<string | null>(null)
  const [resetDone, setResetDone]         = useState(false)

  useEffect(() => {
    const api = window.toeverApi
    if (!api) return
    api.settings.getAll().then(result => {
      if (result.success && result.data) {
        const s = result.data as AppSettings & { has_stored_password?: boolean; password_readable?: boolean }
        if (s.has_stored_password) setHasStoredPassword(true)
        if (s.password_readable === false) setPasswordReadable(false)
        if (!s.storage_base_path) {
          api.appControl.getDefaultStoragePath?.().then(r => {
            if (r?.success && r.data) {
              setSettings(prev => ({ ...prev, ...s, toever_password: '', storage_base_path: r.data as string }))
            } else {
              setSettings({ ...s, toever_password: '' })
            }
          }).catch(() => setSettings({ ...s, toever_password: '' }))
        } else {
          setSettings({ ...s, toever_password: '' })
        }
      }
    })
    api.playwright.isChromiumInstalled().then(r => {
      if (r.success) setChromiumOk(r.data as boolean)
    })
    api.appControl.getVersion?.().then(r => {
      if (r?.success && r.data) setAppVersion(r.data)
    })
  }, [])

  const handleSave = async () => {
    const api = window.toeverApi
    if (!api) return
    setSaving(true)
    setSaved(false)
    setNeedsRestart(false)
    try {
      const result = await api.settings.save(settings)
      if (result.success) {
        // 비밀번호 저장 후 상태 초기화 처리
        if (settings.toever_password.trim() !== '') {
          setHasStoredPassword(true)
          setPasswordReadable(true)
          setChangingPassword(false)
          setSettings(s => ({ ...s, toever_password: '' }))
        }
        setSaved(true)
        const d = result.data as { needsRestart?: boolean } | undefined
        if (d?.needsRestart) {
          setNeedsRestart(true)
        } else {
          setTimeout(() => setSaved(false), 3000)
        }
      }
    } finally {
      setSaving(false)
    }
  }

  const handleRestart = async () => {
    await window.toeverApi?.appControl.relaunch()
  }

  const handleTestStorage = async () => {
    const api = window.toeverApi
    if (!api) return
    const result = await api.fs.storageStatus()
    if (result.success && result.data != null) {
      setStorageOk(result.data as boolean)
    }
  }

  const handleBrowseStorage = async () => {
    const api = window.toeverApi
    if (!api) return
    const r = await api.fs.selectFolder({
      title: '저장소 기본 경로 선택',
      defaultPath: settings.storage_base_path || undefined,
    })
    if (r.success && r.data) {
      setSettings(s => ({ ...s, storage_base_path: r.data as string }))
      setStorageOk(null)
    }
  }

  const handleBrowseBackup = async () => {
    const api = window.toeverApi
    if (!api) return
    const r = await api.fs.selectFolder({
      title: '백업 경로 선택',
      defaultPath: settings.backup_path || undefined,
    })
    if (r.success && r.data) {
      setSettings(s => ({ ...s, backup_path: r.data as string }))
    }
  }

  const RESET_CONFIRM_WORD = '초기화'

  const handleResetAll = async () => {
    const api = window.toeverApi
    if (!api?.system?.resetAll) return
    if (resetConfirmText !== RESET_CONFIRM_WORD) return

    const ok = window.confirm(
      '정말로 모든 데이터를 초기화하시겠습니까?\n\n' +
      '삭제 대상: DB 전체(주문/송장/설정/계정정보), 생성된 파일, 업로드된 원본 파일, 로그, 스크린샷\n' +
      '이 작업은 되돌릴 수 없습니다. 계속하시겠습니까?'
    )
    if (!ok) return

    setResetting(true)
    setResetError(null)
    try {
      const r = await api.system.resetAll({ confirmed: true })
      if (r.success) {
        setResetDone(true)
        setTimeout(async () => {
          await api.appControl.relaunch()
        }, 1500)
      } else {
        setResetError(r.error ?? '초기화 실패')
        setResetting(false)
      }
    } catch (e) {
      setResetError(String(e))
      setResetting(false)
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

  const browseBtn = {
    padding: '8px 14px',
    borderRadius: 6,
    background: '#1e293b',
    border: '1px solid #475569',
    color: '#94a3b8',
    fontSize: 12,
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
    flexShrink: 0,
  }

  return (
    <div style={{ padding: 24, maxWidth: 640, display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#f1f5f9' }}>설정</h1>
        <button className="btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? '저장 중...' : saved ? '✓ 저장됨' : '저장'}
        </button>
      </div>

      {/* 재시작 필요 배너 */}
      {needsRestart && (
        <div style={{
          padding: '12px 16px', borderRadius: 8,
          background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
        }}>
          <div style={{ fontSize: 13, color: '#fde68a' }}>
            ⚠ 설정 변경이 적용되려면, 앱을 재시작해야 합니다.
          </div>
          <button onClick={handleRestart} style={{
            padding: '6px 14px', borderRadius: 6, fontSize: 12,
            background: '#f59e0b', color: '#0f172a', border: 'none', cursor: 'pointer', fontWeight: 600,
            flexShrink: 0,
          }}>
            지금 재시작
          </button>
        </div>
      )}

      {/* 투에버 계정 설정 */}
      <SectionCard title="투에버 계정 설정">
        {/* 이미 저장된 경우 상태 배너 표시 */}
        {settings.toever_id && hasStoredPassword && !changingPassword && (
          <div style={{
            padding: '10px 14px', borderRadius: 8,
            background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <div>
              <span style={{ fontSize: 13, color: '#86efac', fontWeight: 600 }}>✓ 로그인 정보 저장됨</span>
              <span style={{ fontSize: 12, color: '#64748b', marginLeft: 8 }}>
                ID: {settings.toever_id}
              </span>
            </div>
            <button
              onClick={() => setChangingPassword(true)}
              style={{ ...browseBtn, fontSize: 11 }}
            >
              변경
            </button>
          </div>
        )}

        <FieldRow label="투에버 ID" hint="투에버 Support 사이트에서 사용하는 ID를 입력하세요.">
          <input
            type="text"
            value={settings.toever_id}
            onChange={e => setSettings(s => ({ ...s, toever_id: e.target.value }))}
            style={inputStyle}
            placeholder="투에버 로그인 ID"
          />
        </FieldRow>

        {/* 비밀번호: 이미 저장된 경우 다른 방식으로 표시 */}
        {!passwordReadable && (
          <div style={{
            marginBottom: 12, padding: '10px 14px', borderRadius: 8,
            background: '#451a1a', border: '1px solid #ef4444',
            fontSize: 13, color: '#fca5a5',
          }}>
            ⚠ 저장된 비밀번호를 이 PC에서 읽을 수 없습니다.
            다른 PC에서 백업/복구했거나 처음 설치한 경우, 비밀번호를 다시 입력하고 저장해주세요.
          </div>
        )}
        {hasStoredPassword && passwordReadable && !changingPassword ? (
          <FieldRow label="비밀번호">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                flex: 1, padding: '8px 12px', borderRadius: 6,
                background: '#0f172a', border: '1px solid #1e3a2f',
                fontSize: 13, color: '#4ade80',
              }}>
                ✓ 암호화 저장됨 &nbsp;
                <span style={{ color: '#334155', fontSize: 12 }}>
                  (Windows DPAPI 암호화)
                </span>
              </div>
              <button
                onClick={() => setChangingPassword(true)}
                style={browseBtn}
              >
                비밀번호 변경
              </button>
            </div>
          </FieldRow>
        ) : (
          <FieldRow
            label={changingPassword ? '새 비밀번호' : '비밀번호'}
            hint="비밀번호는 Windows DPAPI로 암호화됩니다. 이 PC 계정 로그인 없이 복호화 불가합니다."
          >
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                type={showPassword ? 'text' : 'password'}
                value={settings.toever_password}
                onChange={e => setSettings(s => ({ ...s, toever_password: e.target.value }))}
                style={{ ...inputStyle, flex: 1 }}
                placeholder={changingPassword ? '새 비밀번호 입력' : '비밀번호 입력'}
                autoFocus={changingPassword}
              />
              <button style={browseBtn} onClick={() => setShowPassword(v => !v)}>
                {showPassword ? '숨기기' : '표시'}
              </button>
              {changingPassword && (
                <button
                  style={{ ...browseBtn, color: '#ef4444', borderColor: '#ef4444' }}
                  onClick={() => {
                    setChangingPassword(false)
                    setSettings(s => ({ ...s, toever_password: '' }))
                  }}
                >
                  취소
                </button>
              )}
            </div>
          </FieldRow>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
          <button
            disabled={loginTesting || !settings.toever_id}
            onClick={async () => {
              const api = window.toeverApi
              if (!api?.settings.testLogin) return
              setLoginTesting(true)
              setLoginTestMsg(null)
              const r = await api.settings.testLogin()
              setLoginTesting(false)
              if (r.success) {
                setLoginTestMsg('✓ 투에버 로그인 성공')
              } else {
                setLoginTestMsg(`✗ ${r.error ?? '로그인 실패'}`)
              }
            }}
            style={{
              ...browseBtn,
              opacity: loginTesting ? 0.6 : 1,
              cursor: loginTesting ? 'wait' : 'pointer',
            }}
          >
            {loginTesting ? '로그인 테스트 중...' : '로그인 테스트'}
          </button>
          {loginTestMsg && (
            <span style={{
              fontSize: 13,
              color: loginTestMsg.startsWith('✓') ? '#4ade80' : '#f87171',
            }}>
              {loginTestMsg}
            </span>
          )}
        </div>
      </SectionCard>

      {/* 경로 설정 */}
      <SectionCard title="경로 설정">
        <FieldRow label="저장소 기본 경로" hint="주문 파일, 송장 파일, DB가 저장됩니다. 변경 후 앱 재시작이 필요합니다.">
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              type="text"
              value={settings.storage_base_path}
              onChange={e => setSettings(s => ({ ...s, storage_base_path: e.target.value }))}
              style={{ ...inputStyle, flex: 1 }}
              placeholder="예: C:\Users\사용자\Documents\SpringToeverOps"
            />
            <button style={browseBtn} onClick={handleBrowseStorage}>폴더 선택</button>
            <button style={browseBtn} onClick={handleTestStorage}>연결확인</button>
          </div>
          {storageOk !== null && (
            <span style={{ fontSize: 11, color: storageOk ? '#22c55e' : '#ef4444' }}>
              {storageOk ? '✓ 경로 접근 가능' : '✗ 경로 접근 불가'}
            </span>
          )}
        </FieldRow>
        <FieldRow label="백업 저장 경로" hint="데이터/설정 자동백업 경로입니다. 별도 SSD 나 외장 드라이브 권장합니다.">
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              type="text"
              value={settings.backup_path}
              onChange={e => setSettings(s => ({ ...s, backup_path: e.target.value }))}
              style={{ ...inputStyle, flex: 1 }}
              placeholder="예: E:\SpringToeverOpsBackup"
            />
            <button style={browseBtn} onClick={handleBrowseBackup}>폴더 선택</button>
          </div>
        </FieldRow>
      </SectionCard>

      {/* 스케줄러 설정 */}
      <SectionCard title="스케줄러 설정">
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
          <>
            <FieldRow label="자동 주문수집 시각" hint="필요한 만큼 시간을 추가하거나 제거할 수 있습니다.">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {settings.collect_schedule.map((entry, idx) => (
                  <div key={entry.id} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input
                      type="text"
                      value={entry.label}
                      onChange={e => setSettings(s => ({
                        ...s,
                        collect_schedule: s.collect_schedule.map((it, i) => i === idx ? { ...it, label: e.target.value } : it),
                      }))}
                      style={{ ...inputStyle, width: 140 }}
                      placeholder="예: 오전 수집"
                    />
                    <input
                      type="time"
                      value={entry.time}
                      onChange={e => setSettings(s => ({
                        ...s,
                        collect_schedule: s.collect_schedule.map((it, i) => i === idx ? { ...it, time: e.target.value } : it),
                      }))}
                      style={{ ...inputStyle, width: 120 }}
                    />
                    <button
                      onClick={() => setSettings(s => ({
                        ...s,
                        collect_schedule: s.collect_schedule.filter((_, i) => i !== idx),
                      }))}
                      disabled={settings.collect_schedule.length <= 1}
                      style={{ ...browseBtn, color: '#ef4444', borderColor: '#ef4444', opacity: settings.collect_schedule.length <= 1 ? 0.4 : 1 }}
                    >
                      제거
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => setSettings(s => ({
                    ...s,
                    collect_schedule: [...s.collect_schedule, { id: makeScheduleId(), time: '12:00', label: `수집 ${s.collect_schedule.length + 1}차` }],
                  }))}
                  style={{ ...browseBtn, alignSelf: 'flex-start' }}
                >
                  + 수집 시간 추가
                </button>
              </div>
            </FieldRow>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <FieldRow label="투에버 송장 자동 업로드 시각" hint="이지어드민 송장 파일 임포트는 여전히 수동입니다. 비워두면 자동 업로드가 꺼지고 수동 버튼만 사용됩니다.">
                <div style={{ display: 'flex', gap: 6 }}>
                  <input type="time" value={settings.invoice_upload_time}
                    onChange={e => setSettings(s => ({ ...s, invoice_upload_time: e.target.value }))}
                    style={inputStyle} />
                  {settings.invoice_upload_time && (
                    <button style={browseBtn} onClick={() => setSettings(s => ({ ...s, invoice_upload_time: '' }))}>
                      끄기
                    </button>
                  )}
                </div>
              </FieldRow>
              <FieldRow label="마감 백업 시각" hint="기본: 17:30">
                <input type="time" value={settings.close_backup_time}
                  onChange={e => setSettings(s => ({ ...s, close_backup_time: e.target.value }))}
                  style={inputStyle} />
              </FieldRow>
            </div>
          </>
        )}
        <div style={{ fontSize: 11, color: '#475569' }}>
          스케줄러는 평일(월~금, 공휴일·회사휴일 제외)에만 실행됩니다.
        </div>
      </SectionCard>

      {/* 휴일 설정 */}
      <HolidaySection settings={settings} setSettings={setSettings} />

      {/* 브라우저 설정 */}
      <SectionCard title="브라우저 설정 (Chromium)">
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
          브라우저 자동화(주문 수집, 송장 업로드)에 사용됩니다. 최초 설치 시 약 150MB 다운로드됩니다.
        </div>
      </SectionCard>

      {/* 데이터 복구 */}
      <SectionCard title="데이터 복구">
        <div style={{ fontSize: 13, color: '#94a3b8' }}>
          다른 PC에서 백업한 데이터를 이 PC로 복구합니다. 별도 SSD 등 외장 드라이브를 연결한 후 진행해 주세요.
        </div>
        <div style={{
          padding: '10px 14px', borderRadius: 8,
          background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)',
          fontSize: 12, color: '#fca5a5'
        }}>
          ⚠ 복구 후 이 PC의 기존 데이터는 덮어쓰게 됩니다.
        </div>
        <button
          className="btn-secondary"
          onClick={() => setShowRestore(true)}
          style={{ alignSelf: 'flex-start' }}
        >
          백업 드라이브 선택 후 복구
        </button>
      </SectionCard>

      {showRestore && (
        <FirstRunModal onClose={() => setShowRestore(false)} />
      )}

      {/* 전체 데이터 초기화 (위험 구역) */}
      <div className="card" style={{ border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.04)' }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: '#fca5a5', marginBottom: 16 }}>⚠ 전체 데이터 초기화</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 13, color: '#94a3b8' }}>
            DB(주문·송장·설정·계정정보 전체)와 생성된 파일, 업로드된 원본 파일, 로그, 스크린샷을
            모두 삭제하고 앱을 처음 설치한 상태로 되돌립니다.
          </div>
          <div style={{
            padding: '10px 14px', borderRadius: 8,
            background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
            fontSize: 12, color: '#fca5a5', fontWeight: 600,
          }}>
            ⚠ 이 작업은 되돌릴 수 없습니다. 필요하다면 초기화 전에 반드시 백업하세요.
          </div>

          {resetDone ? (
            <div style={{ fontSize: 13, color: '#86efac' }}>
              ✓ 초기화 완료. 앱을 재시작하는 중...
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <label style={{ fontSize: 12, color: '#94a3b8' }}>
                  계속하려면 <span style={{ color: '#fca5a5', fontWeight: 700 }}>{RESET_CONFIRM_WORD}</span> 를 입력하세요
                </label>
                <input
                  type="text"
                  value={resetConfirmText}
                  onChange={e => setResetConfirmText(e.target.value)}
                  placeholder={RESET_CONFIRM_WORD}
                  style={{ ...inputStyle, width: 160 }}
                  disabled={resetting}
                />
              </div>
              <button
                onClick={handleResetAll}
                disabled={resetting || resetConfirmText !== RESET_CONFIRM_WORD}
                style={{
                  alignSelf: 'flex-start',
                  padding: '8px 18px', fontSize: 13, fontWeight: 600, borderRadius: 6,
                  background: resetConfirmText === RESET_CONFIRM_WORD ? '#ef4444' : '#334155',
                  color: resetConfirmText === RESET_CONFIRM_WORD ? 'white' : '#64748b',
                  border: 'none',
                  cursor: resetting || resetConfirmText !== RESET_CONFIRM_WORD ? 'default' : 'pointer',
                }}
              >
                {resetting ? '초기화 중...' : '모든 데이터 초기화'}
              </button>
              {resetError && (
                <div style={{ fontSize: 12, color: '#fca5a5' }}>✗ {resetError}</div>
              )}
            </>
          )}
        </div>
      </div>

      {/* 앱 버전 */}
      <div style={{
        marginTop: 8, paddingTop: 16, borderTop: '1px solid rgba(255,255,255,0.06)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        color: '#475569', fontSize: 11,
      }}>
        <span>Spring Toever Ops</span>
        <span style={{
          background: 'rgba(99,102,241,0.12)', color: '#818cf8',
          padding: '2px 8px', borderRadius: 4, fontFamily: 'monospace', fontSize: 11,
        }}>
          v{appVersion || '—'}
        </span>
      </div>
    </div>
  )
}

// ============================================================
// 휴일 관리
// ============================================================

const HOLIDAY_SOURCE_LABEL: Record<string, string> = {
  PUBLIC_SEED: '공휴일(기본 내장)',
  PUBLIC_API: '공휴일(API 동기화)',
  COMPANY: '회사 지정',
}

function HolidaySection({
  settings,
  setSettings,
}: {
  settings: AppSettings
  setSettings: Dispatch<SetStateAction<AppSettings>>
}) {
  const [holidays, setHolidays] = useState<AppHoliday[]>([])
  const [loading, setLoading] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [newDate, setNewDate] = useState('')
  const [newName, setNewName] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState<string | null>(null)

  const thisYear = new Date().getFullYear()

  const loadHolidays = async () => {
    const api = window.toeverApi
    if (!api) return
    setLoading(true)
    try {
      const todayStr = new Date().toISOString().slice(0, 10)
      const r = showAll
        ? await api.holiday.getList()
        : await api.holiday.getList(todayStr, `${thisYear + 1}-12-31`)
      if (r.success && r.data) setHolidays(r.data as AppHoliday[])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadHolidays() }, [showAll]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleAdd = async () => {
    const api = window.toeverApi
    if (!api || !newDate || !newName.trim()) return
    const r = await api.holiday.addCompany(newDate, newName.trim())
    if (r.success) {
      setNewDate('')
      setNewName('')
      loadHolidays()
    }
  }

  const handleDelete = async (id: number) => {
    const api = window.toeverApi
    if (!api) return
    await api.holiday.delete(id)
    loadHolidays()
  }

  const handleSync = async () => {
    const api = window.toeverApi
    if (!api) return
    setSyncing(true)
    setSyncMsg(null)
    try {
      const r = await api.holiday.syncFromApi([thisYear, thisYear + 1])
      if (r.success) {
        const results = r.data as { year: number; count: number }[]
        setSyncMsg(`✓ 동기화 완료: ${results.map(x => `${x.year}년 ${x.count}건`).join(', ')}`)
        loadHolidays()
      } else {
        setSyncMsg(`✗ ${r.error}`)
      }
    } finally {
      setSyncing(false)
    }
  }

  const hInputStyle = {
    padding: '8px 10px', borderRadius: 6, background: '#0f172a',
    border: '1px solid #334155', color: '#f1f5f9', fontSize: 13,
  }
  const hBtnStyle = {
    padding: '8px 14px', borderRadius: 6, background: '#1e293b',
    border: '1px solid #475569', color: '#94a3b8', fontSize: 12,
    cursor: 'pointer' as const, whiteSpace: 'nowrap' as const,
  }

  return (
    <div className="card">
      <h2 style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9', marginBottom: 16 }}>휴일 관리</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 13, color: '#94a3b8' }}>
          등록된 날짜에는 자동 주문수집·투에버 송장 자동업로드·마감 자동백업이 모두 스킵됩니다.
          대한민국 법정공휴일은 기본 내장되어 있으며, 회사 자체 휴일(창립기념일 등)은 아래에서 직접 추가/삭제할 수 있습니다.
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8' }}>
            공공데이터포털 특일정보 API 인증키 (선택)
          </label>
          <input
            type="text"
            value={settings.public_data_api_key}
            onChange={e => setSettings(s => ({ ...s, public_data_api_key: e.target.value }))}
            style={{ ...hInputStyle, width: '100%' }}
            placeholder="data.go.kr 에서 발급받은 서비스 키 (설정 저장 필요)"
          />
          <span style={{ fontSize: 11, color: '#475569' }}>
            입력 후 저장하면 API로 최신 공휴일을 동기화할 수 있습니다. 키가 없어도 내장된 공휴일 목록으로 정상 동작합니다.
          </span>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={handleSync}
            disabled={syncing || !settings.public_data_api_key.trim()}
            style={{ ...hBtnStyle, opacity: !settings.public_data_api_key.trim() ? 0.5 : 1 }}
          >
            {syncing ? '동기화 중...' : `API로 공휴일 동기화 (${thisYear}~${thisYear + 1}년)`}
          </button>
          {syncMsg && (
            <span style={{ fontSize: 12, color: syncMsg.startsWith('✓') ? '#4ade80' : '#f87171' }}>{syncMsg}</span>
          )}
        </div>

        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4, flexWrap: 'wrap' }}>
          <input type="date" value={newDate} onChange={e => setNewDate(e.target.value)} style={hInputStyle} />
          <input
            type="text" value={newName} onChange={e => setNewName(e.target.value)}
            placeholder="회사 휴일 이름 (예: 창립기념일)"
            style={{ ...hInputStyle, flex: 1, minWidth: 160 }}
          />
          <button
            onClick={handleAdd}
            disabled={!newDate || !newName.trim()}
            className="btn-primary"
            style={{ fontSize: 12, padding: '8px 14px' }}
          >
            + 회사 휴일 추가
          </button>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
          <span style={{ fontSize: 12, color: '#64748b' }}>
            {loading ? '불러오는 중...' : `${holidays.length}건 표시`}
          </span>
          <button onClick={() => setShowAll(v => !v)} style={{ ...hBtnStyle, fontSize: 11 }}>
            {showAll ? '다가오는 휴일만 보기' : '전체 보기'}
          </button>
        </div>

        <div style={{ maxHeight: 280, overflowY: 'auto', border: '1px solid #1e293b', borderRadius: 8 }}>
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#0f172a' }}>
                <th style={{ padding: '6px 10px', textAlign: 'left', color: '#94a3b8' }}>날짜</th>
                <th style={{ padding: '6px 10px', textAlign: 'left', color: '#94a3b8' }}>이름</th>
                <th style={{ padding: '6px 10px', textAlign: 'left', color: '#94a3b8' }}>출처</th>
                <th style={{ padding: '6px 10px', textAlign: 'right', color: '#94a3b8' }}></th>
              </tr>
            </thead>
            <tbody>
              {holidays.map(h => (
                <tr key={h.id} style={{ borderTop: '1px solid #1e293b' }}>
                  <td style={{ padding: '6px 10px', color: '#f1f5f9' }}>{h.date}</td>
                  <td style={{ padding: '6px 10px', color: '#f1f5f9' }}>{h.name}</td>
                  <td style={{ padding: '6px 10px', color: '#64748b' }}>{HOLIDAY_SOURCE_LABEL[h.source] ?? h.source}</td>
                  <td style={{ padding: '6px 10px', textAlign: 'right' }}>
                    <button
                      onClick={() => handleDelete(h.id)}
                      style={{ ...hBtnStyle, fontSize: 11, padding: '3px 8px', color: '#ef4444', borderColor: '#ef4444' }}
                    >
                      삭제
                    </button>
                  </td>
                </tr>
              ))}
              {holidays.length === 0 && !loading && (
                <tr>
                  <td colSpan={4} style={{ padding: '14px', textAlign: 'center', color: '#475569' }}>
                    등록된 휴일이 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
