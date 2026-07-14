/**
 * 공공데이터포털(data.go.kr) 특일 정보 API 연동
 *
 * - 한국천문연구원(KASI) 특일 정보 API: SpcdeInfoService/getRestDeInfo
 * - 공공데이터포털에서 발급받은 서비스 키가 설정되어 있으면 실제 API로 공휴일을 동기화하여
 *   하드코딩 시드보다 더 정확한 최신 데이터를 확보한다.
 * - 키가 없거나 API 호출이 실패해도 하드코딩 시드(holidaySeed.ts)가 폴백으로 남아있으므로
 *   스케줄러 동작에는 영향이 없다.
 */

import { upsertPublicHolidays } from './db/repositories'
import { HOLIDAY_SEED } from './holidaySeed'

const KASI_ENDPOINT = 'https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo'

interface KasiItem {
  dateName: string
  locdate: number | string // YYYYMMDD
  isHoliday: 'Y' | 'N'
}

export interface HolidaySyncResult {
  success: boolean
  year: number
  count: number
  error?: string
}

/** 하드코딩 시드 데이터를 DB에 반영 (앱 시작 시 1회 호출, 여러 번 호출해도 안전) */
export function seedHardcodedHolidays(): number {
  return upsertPublicHolidays(HOLIDAY_SEED, 'PUBLIC_SEED')
}

/** data.go.kr 특일 정보 API로 특정 연도 공휴일 동기화 */
export async function syncPublicHolidaysFromApi(apiKey: string, year: number): Promise<HolidaySyncResult> {
  const key = apiKey.trim()
  if (!key) {
    return { success: false, year, count: 0, error: '공공데이터포털 API 인증키가 설정되지 않았습니다.' }
  }

  const url = `${KASI_ENDPOINT}?serviceKey=${encodeURIComponent(key)}&solYear=${year}&numOfRows=100&_type=json`

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15000)
    let res: Response
    try {
      res = await fetch(url, { signal: controller.signal })
    } finally {
      clearTimeout(timeout)
    }

    if (!res.ok) {
      return { success: false, year, count: 0, error: `API 응답 오류: HTTP ${res.status}` }
    }

    const text = await res.text()
    let json: {
      response?: {
        header?: { resultCode?: string; resultMsg?: string }
        body?: { totalCount?: number; items?: { item?: KasiItem[] | KasiItem } }
      }
    }
    try {
      json = JSON.parse(text)
    } catch {
      return {
        success: false, year, count: 0,
        error: `API 응답 파싱 실패 (인증키 오류 가능성): ${text.slice(0, 200)}`,
      }
    }

    const header = json.response?.header
    if (header && header.resultCode !== '00') {
      return { success: false, year, count: 0, error: `API 오류(${header.resultCode}): ${header.resultMsg ?? ''}` }
    }

    const totalCount = Number(json.response?.body?.totalCount ?? 0)
    if (totalCount === 0) {
      return { success: true, year, count: 0 }
    }

    const rawItems = json.response?.body?.items?.item
    const items: KasiItem[] = Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : []

    const holidays = items
      .filter(it => it.isHoliday === 'Y')
      .map(it => {
        const s = String(it.locdate)
        const date = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
        return { date, name: it.dateName }
      })

    upsertPublicHolidays(holidays, 'PUBLIC_API')
    return { success: true, year, count: holidays.length }
  } catch (e) {
    return { success: false, year, count: 0, error: String(e) }
  }
}

/** 지정한 여러 연도를 순서대로 동기화 (연속 실패해도 나머지는 계속 시도) */
export async function syncPublicHolidaysForYears(apiKey: string, years: number[]): Promise<HolidaySyncResult[]> {
  const results: HolidaySyncResult[] = []
  for (const year of years) {
    results.push(await syncPublicHolidaysFromApi(apiKey, year))
  }
  return results
}
