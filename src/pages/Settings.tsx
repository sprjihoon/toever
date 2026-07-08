import { useState, useEffect } from 'react'
import type { AppSettings } from '../../shared/types'
import FirstRunModal from '../components/FirstRunModal'

const DEFAULT_SETTINGS: AppSettings = {
  toever_id:              '',
  toever_password:        '',
  storage_base_path:      '',
  backup_path:            '',
  scheduler_enabled:      true,
  morning_collect_time:   '10:30',
  afternoon_collect_time: '15:30',
  close_backup_time:      '17:30',
}

export default function Settings() {
  const [settings, setSettings]           = useState<AppSettings>(DEFAULT_SETTINGS)
  const [hasStoredPassword, setHasStoredPassword] = useState(false)
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

  useEffect(() => {
    const api = window.toeverApi
    if (!api) return
    api.settings.getAll().then(result => {
      if (result.success && result.data) {
        const s = result.data as AppSettings & { has_stored_password?: boolean }
        if (s.has_stored_password) setHasStoredPassword(true)
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
        // ???? ?? ? ??? ???
        if (settings.toever_password.trim() !== '') {
          setHasStoredPassword(true)
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
      title: '??? ?? ?? ??',
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
      title: '?? ?? ??',
      defaultPath: settings.backup_path || undefined,
    })
    if (r.success && r.data) {
      setSettings(s => ({ ...s, backup_path: r.data as string }))
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
      setChromiumLog(prev => [...prev, '? Chromium ?? ??'])
    } else {
      setChromiumLog(prev => [...prev, `? ??: ${r.error}`])
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
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#f1f5f9' }}>??</h1>
        <button className="btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? '?? ?...' : saved ? '? ???' : '??'}
        </button>
      </div>

      {/* ??? ?? ?? */}
      {needsRestart && (
        <div style={{
          padding: '12px 16px', borderRadius: 8,
          background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
        }}>
          <div style={{ fontSize: 13, color: '#fde68a' }}>
            ? ?? ??? ???????. ?? ????? ?????.
          </div>
          <button onClick={handleRestart} style={{
            padding: '6px 14px', borderRadius: 6, fontSize: 12,
            background: '#f59e0b', color: '#0f172a', border: 'none', cursor: 'pointer', fontWeight: 600,
            flexShrink: 0,
          }}>
            ?? ???
          </button>
        </div>
      )}

      {/* ??? ?? ?? */}
      <SectionCard title="??? ?? ??">
        {/* ??? ???? ?? ?? ?? */}
        {settings.toever_id && hasStoredPassword && !changingPassword && (
          <div style={{
            padding: '10px 14px', borderRadius: 8,
            background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <div>
              <span style={{ fontSize: 13, color: '#86efac', fontWeight: 600 }}>? ??? ?? ???</span>
              <span style={{ fontSize: 12, color: '#64748b', marginLeft: 8 }}>
                ID: {settings.toever_id}
              </span>
            </div>
            <button
              onClick={() => setChangingPassword(true)}
              style={{ ...browseBtn, fontSize: 11 }}
            >
              ??
            </button>
          </div>
        )}

        <FieldRow label="??? ID" hint="??? Support ???? ??? ID? ?????.">
          <input
            type="text"
            value={settings.toever_id}
            onChange={e => setSettings(s => ({ ...s, toever_id: e.target.value }))}
            style={inputStyle}
            placeholder="??? ??? ID"
          />
        </FieldRow>

        {/* ????: ??? + ?? ?? ?? */}
        {hasStoredPassword && !changingPassword ? (
          <FieldRow label="????">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                flex: 1, padding: '8px 12px', borderRadius: 6,
                background: '#0f172a', border: '1px solid #1e3a2f',
                fontSize: 13, color: '#4ade80',
              }}>
                ? ???? ??? &nbsp;
                <span style={{ color: '#334155', fontSize: 12 }}>
                  (Windows DPAPI ???)
                </span>
              </div>
              <button
                onClick={() => setChangingPassword(true)}
                style={browseBtn}
              >
                ???? ??
              </button>
            </div>
          </FieldRow>
        ) : (
          <FieldRow
            label={changingPassword ? '? ????' : '????'}
            hint="????? Windows DPAPI? ??????. ?? ? ???? ???? ?????."
          >
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                type={showPassword ? 'text' : 'password'}
                value={settings.toever_password}
                onChange={e => setSettings(s => ({ ...s, toever_password: e.target.value }))}
                style={{ ...inputStyle, flex: 1 }}
                placeholder={changingPassword ? '? ???? ??' : '???? ??'}
                autoFocus={changingPassword}
              />
              <button style={browseBtn} onClick={() => setShowPassword(v => !v)}>
                {showPassword ? '???' : '??'}
              </button>
              {changingPassword && (
                <button
                  style={{ ...browseBtn, color: '#ef4444', borderColor: '#ef4444' }}
                  onClick={() => {
                    setChangingPassword(false)
                    setSettings(s => ({ ...s, toever_password: '' }))
                  }}
                >
                  ??
                </button>
              )}
            </div>
          </FieldRow>
        )}
      </SectionCard>

      {/* ?? ?? */}
      <SectionCard title="?? ??">
        <FieldRow label="??? ?? ??" hint="?? ??, ?? ??, DB? ?????. ?? ? ?? ????? ???.">
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              type="text"
              value={settings.storage_base_path}
              onChange={e => setSettings(s => ({ ...s, storage_base_path: e.target.value }))}
              style={{ ...inputStyle, flex: 1 }}
              placeholder="?: C:\Users\???\Documents\SpringToeverOps"
            />
            <button style={browseBtn} onClick={handleBrowseStorage}>?? ??</button>
            <button style={browseBtn} onClick={handleTestStorage}>???</button>
          </div>
          {storageOk !== null && (
            <span style={{ fontSize: 11, color: storageOk ? '#22c55e' : '#ef4444' }}>
              {storageOk ? '? ?? ?? ??' : '? ?? ?? ??'}
            </span>
          )}
        </FieldRow>
        <FieldRow label="?? ?? ??" hint="??/?? ?? ???????. ?? SSD ? ?? ???? ?????.">
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              type="text"
              value={settings.backup_path}
              onChange={e => setSettings(s => ({ ...s, backup_path: e.target.value }))}
              style={{ ...inputStyle, flex: 1 }}
              placeholder="?: E:\SpringToeverOpsBackup"
            />
            <button style={browseBtn} onClick={handleBrowseBackup}>?? ??</button>
          </div>
        </FieldRow>
      </SectionCard>

      {/* ???? ?? */}
      <SectionCard title="???? ??">
        <FieldRow label="">
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={settings.scheduler_enabled}
              onChange={e => setSettings(s => ({ ...s, scheduler_enabled: e.target.checked }))}
            />
            <span style={{ fontSize: 13, color: '#f1f5f9' }}>???? ???</span>
          </label>
        </FieldRow>
        {settings.scheduler_enabled && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <FieldRow label="?? ?? ??" hint="?: 10:30">
              <input type="time" value={settings.morning_collect_time}
                onChange={e => setSettings(s => ({ ...s, morning_collect_time: e.target.value }))}
                style={inputStyle} />
            </FieldRow>
            <FieldRow label="?? ?? ??" hint="?: 15:30">
              <input type="time" value={settings.afternoon_collect_time}
                onChange={e => setSettings(s => ({ ...s, afternoon_collect_time: e.target.value }))}
                style={inputStyle} />
            </FieldRow>
            <FieldRow label="?? ?? ??" hint="?: 17:30">
              <input type="time" value={settings.close_backup_time}
                onChange={e => setSettings(s => ({ ...s, close_backup_time: e.target.value }))}
                style={inputStyle} />
            </FieldRow>
          </div>
        )}
        <div style={{ fontSize: 11, color: '#475569' }}>
          ????? ??(?~?)?? ?????.
        </div>
      </SectionCard>

      {/* ???? ?? */}
      <SectionCard title="???? ?? (Chromium)">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 13, color: chromiumOk ? '#22c55e' : '#ef4444' }}>
            {chromiumOk === null ? '?? ?...' : chromiumOk ? '? Chromium ???' : '? Chromium ???'}
          </span>
          {!chromiumOk && (
            <button
              className="btn-primary"
              onClick={handleInstallChromium}
              disabled={installingChromium}
              style={{ fontSize: 12 }}
            >
              {installingChromium ? '?? ?...' : 'Chromium ??'}
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
          ???? ??(??? ???, ?? ???)? ?????. ?? ?? ? ? 150MB ???????.
        </div>
      </SectionCard>

      {/* ??? ?? */}
      <SectionCard title="??? ??">
        <div style={{ fontSize: 13, color: '#94a3b8' }}>
          ?? PC?? ??? ???? ? PC? ?????. ?? SSD ?? ???? ?? ??? ?????.
        </div>
        <div style={{
          padding: '10px 14px', borderRadius: 8,
          background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)',
          fontSize: 12, color: '#fca5a5'
        }}>
          ? ?? ? ?? PC? ???? ?? ??? ???????.
        </div>
        <button
          className="btn-secondary"
          onClick={() => setShowRestore(true)}
          style={{ alignSelf: 'flex-start' }}
        >
          ?? ?? ?? ? ??
        </button>
      </SectionCard>

      {showRestore && (
        <FirstRunModal onClose={() => setShowRestore(false)} />
      )}
    </div>
  )
}
