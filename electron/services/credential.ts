/**
 * 투에버 로그인 비밀번호 암호화 저장
 *
 * Electron safeStorage API를 사용한다.
 * Windows에서는 DPAPI(Data Protection API)로 현재 사용자에게만 복호화 가능하다.
 *
 * safeStorage를 사용할 수 없는 환경(개발 시 일부 경우)에서는
 * XOR 기반 난독화 fallback을 사용한다.
 * (실 운영 환경에서는 safeStorage가 항상 동작함)
 */

import { safeStorage } from 'electron'
import { getSetting, setSetting } from './db/repositories'

const KEY_ENCRYPTED_PW = 'toever_password_encrypted'
const KEY_PW_PLAIN     = 'toever_password'  // 구버전 호환용 (마이그레이션 후 삭제)

/**
 * 비밀번호를 암호화해서 DB에 저장한다.
 */
export function savePassword(password: string): void {
  if (!password) {
    setSetting(KEY_ENCRYPTED_PW, '')
    return
  }

  if (safeStorage.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(password)
    // Base64로 변환해서 TEXT 컬럼에 저장
    setSetting(KEY_ENCRYPTED_PW, encrypted.toString('base64'))
    // 구버전 평문 저장 삭제
    setSetting(KEY_PW_PLAIN, '')
  } else {
    // fallback: 난독화 (실 운영에서는 safeStorage 사용 권장)
    setSetting(KEY_ENCRYPTED_PW, obfuscate(password))
    setSetting(KEY_PW_PLAIN, '')
  }
}

/**
 * DB에서 비밀번호를 읽어 복호화한다.
 */
export function loadPassword(): string {
  // 신규 암호화 저장 확인
  const encrypted = getSetting(KEY_ENCRYPTED_PW)
  if (encrypted) {
    if (safeStorage.isEncryptionAvailable()) {
      try {
        const buf = Buffer.from(encrypted, 'base64')
        return safeStorage.decryptString(buf)
      } catch {
        // 복호화 실패 (다른 사용자/PC에서 시도 등)
        return ''
      }
    } else {
      return deobfuscate(encrypted)
    }
  }

  // 구버전 평문 저장 (마이그레이션)
  const plain = getSetting(KEY_PW_PLAIN)
  if (plain) {
    // 자동으로 암호화 저장으로 마이그레이션
    savePassword(plain)
    setSetting(KEY_PW_PLAIN, '')
    return plain
  }

  return ''
}

/**
 * 비밀번호가 저장되어 있는지 확인 (비밀번호 값 자체를 노출하지 않음)
 */
export function hasPasswordStored(): boolean {
  return !!(getSetting(KEY_ENCRYPTED_PW) || getSetting(KEY_PW_PLAIN))
}

/**
 * 저장된 비밀번호를 삭제한다.
 */
export function clearPassword(): void {
  setSetting(KEY_ENCRYPTED_PW, '')
  setSetting(KEY_PW_PLAIN, '')
}

// ============================================================
// Fallback 난독화 (safeStorage 불가 환경 전용)
// ============================================================

const OBFUSCATE_KEY = 0x5a  // 단순 XOR (보안 수준 낮음 - fallback 전용)

function obfuscate(str: string): string {
  const buf = Buffer.from(str, 'utf8')
  for (let i = 0; i < buf.length; i++) buf[i] ^= OBFUSCATE_KEY
  return 'xor:' + buf.toString('base64')
}

function deobfuscate(str: string): string {
  if (!str.startsWith('xor:')) return str
  const buf = Buffer.from(str.slice(4), 'base64')
  for (let i = 0; i < buf.length; i++) buf[i] ^= OBFUSCATE_KEY
  return buf.toString('utf8')
}
