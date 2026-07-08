import { useState, useEffect } from 'react'
import type { AppSettings } from '../../shared/types'

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
  const [settings, setSettings]     = useState<AppSettings>(DEFAULT_SETTINGS)
  const [saving, setSaving]         = useState(false)
  const [saved, setSaved]           = useState(false)
  const [storageOk, setStorageOk]   = useState<boolean | null>(null)
  const [showPassword, setShowPassword] = useState(false)

  useEffect(() => {
    const api = window.toeverApi
    if (!api) return
    api.settings.getAll().then(result => {
      if (result.success && result.data) {
        setSettings(result.data as AppSettings)
      }
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
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#f1f5f9' }}>??</h1>
        <button
          className="btn-primary"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? '?? ?...' : saved ? '? ???' : '??'}
        </button>
      </div>

      {/* ??? ??? ?? */}
      <SectionCard title="??? ??? ???">
        <FieldRow label="??? ID" hint="??? ID? ?? ??????.">
          <input
            type="text"
            value={settings.toever_id}
            onChange={e => setSettings(s => ({ ...s, toever_id: e.target.value }))}
            style={inputStyle}
            placeholder="??? ??? ID"
          />
        </FieldRow>
        <FieldRow label="????" hint="????? Windows DPAPI? ??? ?????. ??? ?? ???? ????.">
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              type={showPassword ? 'text' : 'password'}
              value={settings.toever_password}
              onChange={e => setSettings(s => ({ ...s, toever_password: e.target.value }))}
              style={{ ...inputStyle, flex: 1 }}
              placeholder="??? ????"
            />
            <button
              className="btn-secondary"
              onClick={() => setShowPassword(v => !v)}
              style={{ padding: '8px 12px', fontSize: 12 }}
            >
              {showPassword ? '???' : '??'}
            </button>
          </div>
        </FieldRow>
      </SectionCard>

      {/* ??? ?? */}
      <SectionCard title="??? ??">
        <FieldRow label="?? ???" hint="?? ??, ?? ??, ??? ???? ?????.">
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              type="text"
              value={settings.storage_base_path}
              onChange={e => setSettings(s => ({ ...s, storage_base_path: e.target.value }))}
              style={{ ...inputStyle, flex: 1 }}
            />
            <button className="btn-secondary" onClick={handleTestStorage} style={{ padding: '8px 12px', fontSize: 12 }}>
              ???
            </button>
          </div>
          {storageOk !== null && (
            <span style={{ fontSize: 11, color: storageOk ? '#22c55e' : '#ef4444' }}>
              {storageOk ? '? ?? ??' : '? ?? ??'}
            </span>
          )}
        </FieldRow>
        <FieldRow label="?? ??? (?? SSD)" hint="?? ??? ???? ?????. ?? SSD ??? ?????.">
          <input
            type="text"
            value={settings.backup_path}
            onChange={e => setSettings(s => ({ ...s, backup_path: e.target.value }))}
            style={inputStyle}
          />
        </FieldRow>
      </SectionCard>

      {/* ?? ?? */}
      <SectionCard title="?? ??">
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

      {/* ???? */}
      <SectionCard title="?? ????">
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
          ????? ???(??)?? ?????.
        </div>
      </SectionCard>
    </div>
  )
}
