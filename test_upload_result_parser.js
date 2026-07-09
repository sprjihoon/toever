/**
 * 투에버 업로드 결과 판별 로직 단위 테스트
 * 실행: npx electron test_upload_result_parser.js
 *
 * 브라우저 없이 결과 HTML 패턴만 검증
 */
'use strict'

const C = {
  green:  s => `\x1b[32m${s}\x1b[0m`,
  red:    s => `\x1b[31m${s}\x1b[0m`,
  cyan:   s => `\x1b[36m${s}\x1b[0m`,
  bold:   s => `\x1b[1m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
}
let passed = 0, failed = 0
const failList = []
function pass(msg) { console.log(`  ${C.green('✓')}  ${msg}`); passed++ }
function fail(msg, got, expected) {
  console.log(`  ${C.red('✗')}  ${C.red(msg)}`)
  if (got !== undefined) console.log(`     ${C.yellow(`got="${got}" expected="${expected}"`)}`)
  failed++; failList.push(msg)
}
function section(m) { console.log(`\n${C.bold(C.cyan('▶ ' + m))}`) }

// ── 실제 browser.ts 판별 로직 재현 ────────────────────────────────
function parseUploadResult(resultContent) {
  const successMatch = resultContent.match(/성공=(\d+)/)
  const skipMatch    = resultContent.match(/스킵=(\d+)/)
  const successCount = successMatch ? parseInt(successMatch[1], 10) : null
  const skipCount    = skipMatch    ? parseInt(skipMatch[1],    10) : 0
  const hasErrorText = resultContent.includes('오류') ||
                       resultContent.includes('실패') ||
                       resultContent.includes('ERROR') ||
                       resultContent.includes('error')

  let resultStatus, resultMessage

  if (successCount === null) {
    resultStatus  = 'UNCLEAR'
    resultMessage = '결과 파싱 불가 (성공=N 패턴 없음)'
  } else if (successCount > 0) {
    resultStatus  = 'SUCCESS'
    resultMessage = `성공=${successCount}, 스킵=${skipCount}`
  } else if (successCount === 0 && skipCount === 0) {
    resultStatus  = 'FAIL'
    resultMessage = 'TOEVER_UPLOAD_NO_ROWS: 성공=0, 스킵=0'
  } else {
    resultStatus  = 'SKIP'
    resultMessage = `성공=0, 스킵=${skipCount} (전체 스킵)`
  }

  if (hasErrorText && resultStatus !== 'FAIL') {
    const errSnippet = resultContent.match(/[가-힣\w\s]*오류[가-힣\w\s]*/)?.[0]?.slice(0, 100) ?? ''
    resultMessage += ` | 오류문구: ${errSnippet}`
  }

  return { successCount, skipCount, resultStatus, resultMessage, hasErrorText }
}

// ── 테스트 케이스 정의 ─────────────────────────────────────────────
const cases = [
  {
    label: '케이스1: 성공>0 → SUCCESS',
    html:  '완료: 정상 처리되었습니다. 성공=5, 스킵=0',
    expect: { resultStatus: 'SUCCESS', successCount: 5, skipCount: 0 },
  },
  {
    label: '케이스1b: 성공>0, 스킵>0 → SUCCESS',
    html:  '완료: 정상 처리되었습니다. 성공=3, 스킵=2',
    expect: { resultStatus: 'SUCCESS', successCount: 3, skipCount: 2 },
  },
  {
    label: '케이스3: 성공=0이지만 정상처리 문구 → 성공 아님',
    html:  '완료: 정상 처리되었습니다. 성공=0, 스킵=0',
    expect: { resultStatus: 'FAIL', successCount: 0, skipCount: 0 },
  },
  {
    label: '케이스4: 성공=0, 스킵=0 → TOEVER_UPLOAD_NO_ROWS',
    html:  'TOEVER\n주문번호\t송장번호\n완료: 정상 처리되었습니다. 성공=0, 스킵=0\n동일한 발주번호에 동일한 송장번호가 이미 있어서모든데이터가 입력되지 않았습니다.',
    expect: { resultStatus: 'FAIL', successCount: 0 },
    msgIncludes: 'TOEVER_UPLOAD_NO_ROWS',
  },
  {
    label: '케이스5a: 성공=0, 스킵>0 → SKIP',
    html:  '완료: 정상 처리되었습니다. 성공=0, 스킵=10',
    expect: { resultStatus: 'SKIP', successCount: 0, skipCount: 10 },
  },
  {
    label: '케이스5b: 성공=0, 스킵>0 + 오류 문구 → SKIP + 오류 기록',
    html:  '완료: 정상 처리되었습니다. 성공=0, 스킵=3\n이미 처리된 오류 내역입니다.',
    expect: { resultStatus: 'SKIP', successCount: 0, hasErrorText: true },
    msgIncludes: '오류문구',
  },
  {
    label: '케이스6: 성공 패턴 없음 → UNCLEAR',
    html:  '처리 결과를 확인할 수 없습니다.',
    expect: { resultStatus: 'UNCLEAR', successCount: null },
  },
  {
    label: '케이스6b: 완전 빈 응답 → UNCLEAR',
    html:  '',
    expect: { resultStatus: 'UNCLEAR', successCount: null },
  },
  {
    label: '케이스6c: 서버 500 오류 → UNCLEAR',
    html:  '<html><body>Internal Server error</body></html>',
    expect: { resultStatus: 'UNCLEAR', successCount: null },
  },
  {
    label: '케이스2+오류: 성공>0이지만 오류 테이블도 있음 → SUCCESS (성공 건수 우선)',
    html:  '완료: 정상 처리되었습니다. 성공=2, 스킵=1\n일부 오류 데이터가 있습니다.',
    expect: { resultStatus: 'SUCCESS', successCount: 2 },
    msgIncludes: '오류문구',
  },
]

section('업로드 결과 판별 로직 단위 테스트')
console.log()

for (const tc of cases) {
  const r = parseUploadResult(tc.html)

  let ok = true
  const checks = []

  // resultStatus
  if (r.resultStatus !== tc.expect.resultStatus) {
    ok = false
    checks.push(`resultStatus: got="${r.resultStatus}" expected="${tc.expect.resultStatus}"`)
  }
  // successCount
  if (tc.expect.successCount !== undefined && r.successCount !== tc.expect.successCount) {
    ok = false
    checks.push(`successCount: got=${r.successCount} expected=${tc.expect.successCount}`)
  }
  // skipCount
  if (tc.expect.skipCount !== undefined && r.skipCount !== tc.expect.skipCount) {
    ok = false
    checks.push(`skipCount: got=${r.skipCount} expected=${tc.expect.skipCount}`)
  }
  // hasErrorText
  if (tc.expect.hasErrorText !== undefined && r.hasErrorText !== tc.expect.hasErrorText) {
    ok = false
    checks.push(`hasErrorText: got=${r.hasErrorText} expected=${tc.expect.hasErrorText}`)
  }
  // msgIncludes
  if (tc.msgIncludes && !r.resultMessage.includes(tc.msgIncludes)) {
    ok = false
    checks.push(`message should include "${tc.msgIncludes}": got="${r.resultMessage}"`)
  }

  if (ok) {
    pass(`${tc.label}  → ${r.resultStatus} (${r.resultMessage.slice(0, 60)})`)
  } else {
    fail(tc.label, undefined, undefined)
    for (const c of checks) console.log(`     ${C.yellow('• ' + c)}`)
  }
}

// ── 결과 요약 ─────────────────────────────────────────────────────
console.log(`\n${C.bold('══════════════════════════════════════════════')}`)
if (failed === 0) {
  console.log(C.green(C.bold(`  ✓ 전체 ${passed}건 통과 — 업로드 판별 로직 확정`)))
} else {
  console.log(C.green(C.bold(`  ✓ 통과: ${passed}건`)))
  console.log(C.red(C.bold(`  ✗ 실패: ${failed}건`)))
  for (const e of failList) console.log(C.red(`    - ${e}`))
}
console.log(C.bold('══════════════════════════════════════════════\n'))
process.exit(failed > 0 ? 1 : 0)
