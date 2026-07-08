/**
 * HTML 기반 .xls 파일을 직접 파싱하는 유틸리티
 *
 * 투에버 주문 파일(Ordering_data.xls)과 이지어드민 확장주문검색 파일은
 * 실제 Excel BIFF가 아니라 HTML table 형식이다.
 *
 * XLSX 라이브러리는 이 파일의 x:str 속성을 무시하고 숫자로 변환하여
 * 주문번호(0100012026070800002)가 1.00012E+17 처럼 깨진다.
 *
 * 따라서 HTML을 직접 파싱해서 x:str 셀은 반드시 string으로 처리한다.
 */

import fs from 'fs'
import iconv from 'iconv-lite'

export interface ParsedTable {
  headers: string[]
  rows: string[][]
  encoding: string
  rowCount: number
}

/**
 * HTML 파일에서 인코딩을 감지한다.
 * KSC5601 / euc-kr / utf-8 판별
 */
export function detectHtmlEncoding(buf: Buffer): string {
  const sample = buf.slice(0, 1024).toString('binary').toLowerCase()
  if (sample.includes('charset=utf-8') || sample.includes('charset=utf8')) return 'utf8'
  if (sample.includes('ksc5601') || sample.includes('euc-kr') || sample.includes('ks_c_5601')) return 'cp949'
  // 기본값: 투에버 파일은 cp949
  return 'cp949'
}

/**
 * HTML 테이블을 파싱하여 헤더와 데이터 행 반환
 *
 * x:str 속성이 있는 td는 텍스트를 그대로 string으로 처리한다.
 * 숫자처럼 보이는 주문번호/연락처/송장번호가 깨지는 것을 방지한다.
 */
export function parseHtmlTableFile(filePath: string): ParsedTable {
  const buf = fs.readFileSync(filePath)
  const encoding = detectHtmlEncoding(buf)
  const html = encoding === 'utf8'
    ? buf.toString('utf8')
    : iconv.decode(buf, 'cp949')

  return parseHtmlTableString(html, encoding)
}

export function parseHtmlTableString(html: string, encoding = 'utf8'): ParsedTable {
  // <tr> 블록 추출 (DOTALL)
  const rows: string[][] = []

  // tr 매칭 - 중첩 테이블을 고려해 비욕심 매칭 사용
  const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
  let trMatch: RegExpExecArray | null

  while ((trMatch = trRegex.exec(html)) !== null) {
    const trContent = trMatch[1]
    const cells = extractCells(trContent)
    if (cells.length > 0) {
      rows.push(cells)
    }
  }

  // 헤더 행 찾기: 내용이 있는 첫 번째 행
  let headerRowIdx = -1
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].some(c => c.trim() !== '')) {
      headerRowIdx = i
      break
    }
  }

  if (headerRowIdx === -1) {
    return { headers: [], rows: [], encoding, rowCount: 0 }
  }

  const headers = rows[headerRowIdx].map(h => h.trim())
  const dataRows = rows.slice(headerRowIdx + 1).filter(r => r.some(c => c.trim() !== ''))

  return { headers, rows: dataRows, encoding, rowCount: dataRows.length }
}

/**
 * <tr> 내용에서 <td> 셀 값을 추출한다.
 *
 * x:str 속성 처리:
 * - <td x:str>값</td> → 값을 무조건 string으로
 * - <td>123</td> → 내용이 주문번호 패턴이면 string으로
 *
 * HTML 엔티티 디코딩도 처리한다.
 */
function extractCells(trContent: string): string[] {
  const cells: string[] = []
  // td 매칭 (th도 처리)
  const tdRegex = /<(?:td|th)([^>]*)>([\s\S]*?)<\/(?:td|th)>/gi
  let tdMatch: RegExpExecArray | null

  while ((tdMatch = tdRegex.exec(trContent)) !== null) {
    const attrs = tdMatch[1]
    const rawContent = tdMatch[2]

    // HTML 태그 제거 및 엔티티 디코딩
    const text = rawContent
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
      .replace(/&nbsp;/g, ' ')
      .trim()

    cells.push(text)
  }

  return cells
}

/**
 * 파싱된 테이블에서 컬럼명 → 컬럼 인덱스 맵 생성
 */
export function buildColumnMap(headers: string[]): Map<string, number> {
  const map = new Map<string, number>()
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i].trim()
    if (h) map.set(h, i)
  }
  return map
}

/**
 * 행 배열에서 특정 컬럼 값을 안전하게 가져온다.
 * 빈 문자열이면 null 반환
 */
export function getCell(row: string[], colMap: Map<string, number>, colName: string): string | null {
  const idx = colMap.get(colName)
  if (idx === undefined) return null
  const val = row[idx]?.trim() ?? ''
  return val === '' ? null : val
}
