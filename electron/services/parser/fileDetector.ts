import fs from 'fs'

export type FileFormat = 'HTML_XLS' | 'BIFF_XLS' | 'XLSX' | 'CSV' | 'UNKNOWN'

/**
 * 파일 내부 signature로 실제 포맷을 판별한다.
 * 확장자만 믿지 않는다.
 */
export function detectFileFormat(filePath: string): FileFormat {
  const fd = fs.openSync(filePath, 'r')
  const header = Buffer.alloc(8)
  fs.readSync(fd, header, 0, 8, 0)
  fs.closeSync(fd)

  // BIFF xls: OLE/CFBF magic D0 CF 11 E0
  if (header[0] === 0xd0 && header[1] === 0xcf && header[2] === 0x11 && header[3] === 0xe0) {
    return 'BIFF_XLS'
  }

  // XLSX / ZIP: PK
  if (header[0] === 0x50 && header[1] === 0x4b) {
    return 'XLSX'
  }

  // HTML table based xls - read first 512 bytes as text (재파일 읽기 최소화)
  const fd2 = fs.openSync(filePath, 'r')
  const sample = Buffer.alloc(512)
  fs.readSync(fd2, sample, 0, 512, 0)
  fs.closeSync(fd2)
  const text = sample.toString('binary').toLowerCase()
  if (
    text.includes('<html') ||
    text.includes('<table') ||
    text.includes('xmlns:x=') ||
    text.includes('xmlns:o=') ||
    text.includes('<?xml')
  ) {
    return 'HTML_XLS'
  }

  // CSV fallback
  if (filePath.endsWith('.csv')) {
    return 'CSV'
  }

  return 'UNKNOWN'
}

export function detectFileFormatFromBuffer(buf: Buffer): FileFormat {
  if (buf.length < 4) return 'UNKNOWN'

  if (buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0) {
    return 'BIFF_XLS'
  }
  if (buf[0] === 0x50 && buf[1] === 0x4b) {
    return 'XLSX'
  }

  const text = buf.slice(0, 512).toString('binary').toLowerCase()
  if (
    text.includes('<html') ||
    text.includes('<table') ||
    text.includes('xmlns:x=') ||
    text.includes('xmlns:o=') ||
    text.includes('<?xml')
  ) {
    return 'HTML_XLS'
  }

  return 'UNKNOWN'
}
