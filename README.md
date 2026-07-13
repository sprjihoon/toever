# Spring Toever Ops

투에버(Toever Support) ↔ 이지어드민(Ezadmin) 주문·송장 자동화 운영 프로그램

Windows 데스크탑 애플리케이션 (Electron + React + TypeScript)

---

## 주요 기능

| 기능 | 설명 |
|---|---|
| 주문 수집 | 투에버 Support에서 주문 데이터를 자동 다운로드, DB 저장, 중복 방지 |
| 이지어드민 연동 | 신규 출고 대상 주문을 이지어드민 업로드용 Excel 파일로 생성 |
| 송장 Import | 이지어드민에서 다운로드한 확장주문검색 파일을 자동 매칭·저장 |
| 투에버 송장 업로드 | 하루치 송장을 모아 한 번에 일괄 업로드 (수동 버튼, 하루 1회) — 미리보기 확인 후 확정 |
| 수동검토 큐 | 복수 송장·주문 변경 감지 등 자동 처리 불가 건을 별도 큐로 관리 |
| 백업 | SQLite backup API로 DB를 안전하게, 파일 전체를 외장 SSD로 백업 |
| 데이터 복원 | 백업 폴더를 선택하면 어떤 PC에서도 동일 데이터로 복원 |
| 스케줄러 | 오전/오후 주문 수집, 마감 백업 자동 실행 (평일 기준) |
| Chromium 관리 | Playwright 브라우저를 userData에 설치/관리 (앱 재설치 후에도 유지) |
| 발주내역 PDF 저장 | OZ Viewer 저장 버튼 클릭 → PDF 형식 선택 → 확인 → Playwright download 이벤트로 저장 (`pdf/contracts/YYYYMMDD_report_runN.pdf`), 실패해도 주문 수집 흐름 중단 안 함 |

---

## 기술 스택

- **Electron 36** + **React 19** + **TypeScript 5** + **Vite 6**
- **better-sqlite3** (SQLite, WAL 모드)
- **Playwright** (투에버 웹 자동화, Chromium)
- **xlsx (SheetJS)** + 커스텀 HTML 파서 (주문번호 과학적 표기법 방지)
- **node-cron** (스케줄러)
- **electron safeStorage** (DPAPI 기반 비밀번호 암호화)
- **electron-builder** (NSIS Windows 설치 패키지)

---

## 설치 및 실행

### 개발 환경

```bash
# 의존성 설치
npm install

# 개발 서버 실행 (Vite + Electron 동시)
npm run dev

# Playwright Chromium 설치 (최초 1회)
npm run install:playwright
```

### Windows 설치 패키지 빌드

```bash
# TypeScript 컴파일 + Vite 빌드 + NSIS 설치 패키지 생성
npm run build

# 결과물: release/Spring-Toever-Ops-Setup-1.0.0.exe
```

> `better-sqlite3` native 모듈은 빌드 시 자동으로 Electron 버전에 맞게 재빌드됩니다.

---

## 어떤 PC에도 설치 가능

1. `release/Spring-Toever-Ops-Setup-*.exe`를 대상 PC에서 실행
2. 설치 마법사에서 설치 경로 선택 → 설치 완료
3. 처음 실행 시 자동으로 "첫 실행 마법사" 표시
   - **새로 시작하기**: 빈 DB로 시작 → 설정에서 투에버 ID/비밀번호 입력
   - **백업에서 복원하기**: 기존 PC의 백업 폴더 선택 → 동일 데이터 복원

---

## 백업 & 복원

### 백업

- **자동 백업**: 스케줄러가 매일 마감 시각에 외장 SSD로 자동 백업
- **수동 백업**: 대시보드 "지금 백업" 버튼

백업 구조:
```
E:\SpringToeverOpsBackup\
  └── 2026\07\08\20260708_173000\
      ├── database\toever_ops.db      ← SQLite backup API로 안전 복사
      ├── raw\toever_orders\          ← 원본 주문 Excel 파일
      ├── raw\ezadmin_invoice\        ← 원본 송장 Excel 파일
      ├── generated\ezadmin_upload\   ← 이지어드민 업로드 파일
      ├── generated\toever_invoice_upload\
      ├── pdf\contracts\
      └── logs\
```

### 다른 PC로 복원

1. 외장 SSD를 새 PC에 연결
2. Spring Toever Ops 실행 → 첫 실행 마법사 표시
3. "백업에서 복원하기" → 백업 날짜 폴더 선택 (예: `E:\SpringToeverOpsBackup\2026\07\08\20260708_173000`)
4. 복원 확인 → 앱 자동 재시작 → 동일 데이터 표시

설정 메뉴 → "데이터 복원" 버튼에서도 언제든지 복원 가능합니다.

---

## 저장 구조

기본 경로: `D:\SpringToeverOps` (설정에서 변경 가능, D: 없으면 AppData로 자동 fallback)

```
D:\SpringToeverOps\
  ├── database\toever_ops.db
  ├── raw\
  │   ├── toever_orders\      투에버 원본 주문 Excel
  │   └── ezadmin_invoice\    이지어드민 원본 송장 Excel
  ├── generated\
  │   ├── ezadmin_upload\     이지어드민 업로드용 생성 파일
  │   └── toever_invoice_upload\  투에버 송장 업로드용 생성 파일
  ├── pdf\contracts\
  └── logs\
      ├── automation\
      └── screenshots\
```

---

## 업무 흐름

```
[투에버 주문 수집] (자동/수동)
    ↓ Excel 다운로드 + HTML 파싱
[중복 필터링 + DB 저장]
    ↓ NEW_SHIPMENT_TARGET 주문만
[이지어드민 업로드 파일 생성] → [이지어드민에서 출고 처리] (수동)
    ↓ 이지어드민 확장주문검색 파일 다운로드
[이지어드민 송장 Import] → 주문번호 자동 매칭 → INVOICE_IMPORTED 누적
    ↓ (하루 중 여러 차례 반복 가능 — 누적됨)
[투에버 일일 일괄 업로드] → 수동 버튼 클릭 → 미리보기 확인 → 확정 → 전체 일괄 업로드
    ↓ 업로드 완료 건 → TOEVER_INVOICE_UPLOADED (자동 제외)
```

---

## 상태 변경 작업 — Confirm / Dry-run 안전장치

투에버 **송장 업로드**와 **출고작업지시**는 실제 투에버 서버에 쓰기 작업을 수행합니다.
잘못된 실행을 방지하기 위해 두 단계 안전장치를 적용합니다.

### 안전장치 흐름

| 단계 | IPC 채널 | 설명 |
|---|---|---|
| 1. 미리 보기 | `invoice:previewUpload` / `storeout:preview` | 브라우저 없이 대상 주문번호·송장번호 목록만 반환 |
| 2. 사용자 확인 | UI에서 목록 표시 후 확인 버튼 | 확인 없이 실행 불가 |
| 3. 실행 | `invoice:uploadToever` / `storeout:execute` | `confirmed: true` 없으면 `CONFIRM_REQUIRED` 오류 반환 |

### Dry-run 기본값

| 옵션 | 동작 |
|---|---|
| `dryRun: true` (기본) | 파일 첨부 / 체크박스 탐색까지만, 버튼 클릭·submit 안 함 |
| `dryRun: false` | 실제 uploadBtn 클릭 / submit 실행 |

### 결과 불명확 처리

- 투에버 응답 페이지에서 성공 메시지도 실패 메시지도 없는 경우 → **자동 재시도 금지**
- `manual_review_queue`에 `STOREOUT_UNCLEAR` / `UPLOAD_PARTIAL_FAIL` 타입으로 등록
- 담당자가 수동으로 투에버 화면을 확인 후 처리

---

## 투에버 송장 업로드 — 결과 판별 기준

`uploadOK.jsp` 응답 페이지를 파싱해 아래 7가지 규칙으로 최종 결과를 결정합니다.
**자동 재시도는 하지 않습니다.**

| 조건 | `resultStatus` | 처리 |
|---|---|---|
| `성공=N (N > 0)` | `SUCCESS` | 정상 완료 |
| `성공=0` (문구 무관) | `FAIL` | 실패 기록 |
| `성공=0, 스킵=0` | `FAIL` — `TOEVER_UPLOAD_NO_ROWS` | 빈 파일 또는 전체 오류 |
| `성공=0, 스킵>0` | `SKIP` | 전체 중복/스킵 |
| 오류/빨간 글씨 문구 포함 | 위 판정 유지 + 오류 문구 기록 | 실패 사유 명시 |
| `성공=N` 패턴 미존재 | `UNCLEAR` | `manual_review_queue` 등록 |

> **주의**: `"정상 처리되었습니다"` 문구가 있어도 `성공=0` 이면 성공으로 처리하지 않습니다.

---

## 투에버 송장 업로드 — 누적 처리 방식

송장 업로드는 **누적 처리** 방식으로 동작합니다.

### 동작 원리

- 이지어드민 송장 Import를 오전·오후 여러 차례 실행해도 매칭된 주문이 DB에 **계속 누적**됩니다.
- 투에버 송장 업로드 버튼을 누르면 `INVOICE_IMPORTED` / `TOEVER_INVOICE_READY` 상태인 주문만 조회해 한 번에 업로드합니다.
- 업로드 완료된 주문은 즉시 `TOEVER_INVOICE_UPLOADED` 상태로 전환되어 **다음 업로드에서 자동 제외**됩니다.

### 하루 업무 예시

```
오전 송장 Import  → INVOICE_IMPORTED 10건 누적
오전 업로드 실행  → 10건 업로드 완료 → TOEVER_INVOICE_UPLOADED

오후 추가 발주 처리
오후 송장 Import  → INVOICE_IMPORTED 7건 추가 누적
오후 업로드 실행  → 오전 10건 제외, 신규 7건만 업로드 완료
```

> 오전에 업로드한 건은 상태가 `TOEVER_INVOICE_UPLOADED`이므로 오후 업로드 시 쿼리 대상에서 자동으로 배제됩니다. 중복 업로드 위험 없습니다.

---

## Excel 주문번호 안전 처리

투에버 주문번호는 19자리 숫자(`0100012026070800002`)이며, Excel이 직접 열면 `1.00012E+17`로 변환됩니다.

**방어 전략:**
1. **읽기**: `Ordering_data.xls`는 HTML 테이블 형식 → 직접 HTML 파싱으로 숫자 변환 없이 문자열 추출
2. **검증**: `safeString.ts`의 `isValidOrderNo()` / `isScientificNotationRisk()`로 이상 값 감지
3. **생성**: 이지어드민 업로드 파일의 주문번호 컬럼에 텍스트 서식 강제 (`t:'s', z:'@'`)

---

## DB 스키마 요약

| 테이블 | 설명 |
|---|---|
| `order_header` | 주문 헤더 (주문번호, 수취인, 상태, 해시) |
| `order_item` | 주문 상품 라인 |
| `invoice_event` | 송장 입력 이력 |
| `ezadmin_export_batch` | 이지어드민 업로드 배치 |
| `manual_review_queue` | 수동 검토 큐 |
| `file_artifact` | 파일 메타데이터 + SHA-256 |
| `app_run` | 자동화 실행 감사 로그 |
| `toever_action_log` | 브라우저 자동화 액션 로그 |
| `backup_history` | 백업 이력 |
| `app_settings` | 앱 설정 (key-value) |

---

## 보안

- 투에버 비밀번호: `electron safeStorage` (Windows DPAPI)로 암호화 저장
- Preload 스크립트: `contextIsolation: true`, `nodeIntegration: false`
- 민감 파일: `.gitignore`로 DB, 로그, 설정 파일 제외

---

## 개발 참고

```bash
# native 모듈 재빌드 (Electron 버전 변경 시)
npm run rebuild:native

# 렌더러만 빌드
npm run build:renderer

# Electron main만 빌드
npm run build:electron

# 설치 없이 디렉토리 형태로 빌드 확인
npm run build:dir
```

---

## 버전 이력

| 버전 | 날짜 | 주요 변경 |
|---|---|---|
| 1.0.0 | 2026-07-08 | 최초 릴리즈 |
| 1.0.1 | 2026-07-08 | P0/P1 버그 수정: DB 경로 재초기화, upsertOrderHeader 상태 업데이트, FAILED run 재시도, ezadmin export 날짜 필터 제거, restartScheduler 연동, 업로드 성공 판별 강화 |
| 1.0.2 | 2026-07-09 | 이지어드민 업로드 파일명에 round(morning/afternoon/manual) + 순번(1차/2차...) 포함, 미사용 설정 항목(company_cd, merchant_cd, entr_no) 제거, 투에버 송장 누적 처리 방식 문서화 |
| 1.0.3 | 2026-07-09 | `savePdfReport` 추가: 발주내역 출력 URL을 headless Chromium으로 PDF 저장 (`pdf/contracts/`), 조회 결과 없으면 `PDF_SKIPPED_NO_ORDER_RANGE` skip, PDF 실패 시 주 흐름 중단 안 함 |
| 1.0.4 | 2026-07-09 | 상태 변경 작업 Confirm/Dry-run 안전장치 추가: 송장 업로드·출고작업지시 모두 confirmed=true 없으면 실행 차단, dryRun 기본값 적용, 결과 불명확 시 수동검토 큐 등록 |
| 1.0.5 | 2026-07-09 | 투에버 송장 업로드 결과 판별 로직 확정 (7가지 기준): 성공>0→SUCCESS, 성공=0→FAIL, 성공=0 스킵=0→TOEVER_UPLOAD_NO_ROWS, 파싱불가→UNCLEAR+수동검토 큐, 자동재시도 제거 |
| 1.0.6 | 2026-07-09 | `savePdfReport` PDF 저장 방식 변경: page.pdf() 폐기 → OZ Viewer 저장 버튼(btnSAVEAS) 클릭 → select[1] Adobe PDF 선택 → 확인 클릭 → Playwright download 이벤트 수신 (74 KB, .pdf 확인됨) |
| 1.0.7 | 2026-07-13 | 투에버 송장 업로드 하루 1회 일괄 처리 확정: `getDailyInvoiceStatus()` 추가(오늘 업로드 여부·대기 건수·미리보기 목록), `invoice:getDailyStatus` IPC 추가, `uploadToever` confirmed 파라미터 누락 버그 수정, InvoiceManager UI 전면 개편(일일 현황 배너·미리보기 테이블·2단계 확인 흐름·dryRun 감지 오류 수정) |

---

## 소스 파일 인코딩 주의사항

이 프로젝트의 모든 `.ts`/`.tsx` 파일은 **UTF-8 (BOM 없음)** 으로 저장해야 합니다.

- `.editorconfig`로 UTF-8 인코딩이 강제됩니다.
- Windows 환경에서 파일을 직접 수정할 경우 반드시 UTF-8로 저장하세요.
- PowerShell로 파일을 생성/수정할 때는 `[System.IO.File]::WriteAllText(path, content, New-Object System.Text.UTF8Encoding($false))` 방식을 사용하세요.
- 한국어 문자열이 `?`로 저장되는 경우 CP949 인코딩 문제입니다. PowerShell 기본 코드페이지(949)에서 UTF-8 데이터가 잘못 변환될 수 있습니다.


## 저장 경로 설정

저장 경로는 **하드코딩되지 않습니다.** 최초 실행 마법사 또는 설정 메뉴에서 사용자가 직접 지정합니다. 기본값은 `C:\Users\{사용자}\Documents\SpringToeverOps`이며, 변경 후 앱 재시작이 필요합니다.

## 리포트 빌더 (Report Builder)

사이드바 **📈 리포트** 메뉴에서 접근 가능. 지표를 자유롭게 조합해 보고서 세트를 저장하고 반복 사용할 수 있습니다.

| 기능 | 설명 |
|------|------|
| 위젯 팔레트 | 17종 지표(요약/트렌드/제품/분포/운영) 중 선택·추가 |
| 보고서 세트 저장 | 이름 지정 후 저장 → 왼쪽 사이드바에서 즉시 재호출 |
| 위젯 편집 | 라벨명 수정, 크기(소/중/대/전폭) 조정, ↑↓ 순서 변경, TOP N 설정 |
| 기간 선택 | 오늘/이번주/이번달/지난달/분기/반기/올해 빠른 선택 |
| 집계 단위 | 일별/주별/월별/분기별/반기별/연도별 |

---

## 심층 코드 검토 결과 (2026-07-09)

심층 분석에서 발견된 47개 이슈 중 Critical/High 우선순위 항목 수정 완료:

### 수정된 버그 목록

| 파일 | 분류 | 수정 내용 |
|------|------|-----------|
| storage.ts | Critical | getKSTDateString() 유틸리티 추가. UTC 	oISOString() 대신 KST 기준 날짜 반환 (00:00~08:59 KST에서 전날 날짜 반환되는 버그 수정) |
| storage.ts | Critical | DEFAULT_BASE = 'D:\\SpringToeverOps' 하드코딩 제거, 초기값 ''로 변경 |
| duplicateFilter.ts | Critical | EZADMIN_BATCH_CANCELLED 처리 로직 추가: 동일 내용이면 재출고, 변경이면 수동검토로 분류 |
| duplicateFilter.ts | Medium | ORDER_CHANGED_REVIEW 수동검토 항목 중복 삽입 방지 (hasOpenReview 체크) |
| 
epositories.ts | Critical | insertOrderItems: INSERT OR REPLACE → delete-then-insert로 변경해 누적 중복행 방지 |
| 
epositories.ts | Medium | hasOpenReview() 함수 추가 (같은 주문+타입의 OPEN 리뷰 중복 삽입 방지) |
| ezadminUploadBuilder.ts | Critical | 파일아티팩트 저장 + 배치 생성 + 상태변경을 단일 SQLite 트랜잭션으로 래핑 |
| scheduler.ts | Critical | 	oday() UTC → KST getKSTDateString() 교체; 스케줄러 콜백 async 에러핸들링 추가; 잘못된 시간 형식 유효성 검사 |
| handlers.ts | Critical | 
eedsRestart 로직: prevStoragePath 비교 → getBasePath() 비교로 수정 (첫 실행 시 경로 설정이 재시작 없이 적용되던 버그 수정) |
| orchestrator.ts | Critical | existingRun.status === 'RUNNING' 처리: 앱 비정상 종료 후 재시작 시 UNIQUE 제약 위반 수정 |
| Dashboard.tsx | Critical | 	oday() UTC → KST 	odayKST() 교체; usiness_date를 	oday() 대신 dateFrom(사용자 선택 날짜)으로 수정; 날짜 역순 유효성 검사 추가 |

### 2026-07-09 2차 심층 검토 수정 목록

| 파일 | 심각도 | 수정 내용 |
|------|--------|-----------|
| handlers.ts | CRITICAL | `needsRestart` 버그: `setBasePath` 호출 전 `prevPath` 저장 후 비교로 수정 |
| handlers.ts | HIGH | `app:isFirstRun`: 오늘 날짜 기준 → 전체 `order_header` 건수 기준으로 수정 |
| browserManager.ts | CRITICAL | Chromium spawn 시 `ELECTRON_RUN_AS_NODE=1` 환경변수 추가 (패키징 환경 대응) |
| ezadminUploadBuilder.ts | CRITICAL | `order_header.ezadmin_batch_id` 연결 (배치 추적·취소 추적 가능) |
| repositories.ts | HIGH | `cancelEzadminBatch`: 배치 취소 시 연결 주문을 `EZADMIN_BATCH_CANCELLED`로 원자적 변경 |
| repositories.ts | HIGH | `parseTemplate`: JSON.parse 예외 처리 추가 (손상된 위젯 JSON 시 빈 배열 반환) |
| repositories.ts | MEDIUM | `searchOrders`: `product_name`, `option_name` 서브쿼리 필터 구현 |
| orchestrator.ts | HIGH | `importEzadminInvoice`: 파일 존재 검증 추가 |
| backup.ts | HIGH | 백업 폴더 날짜를 UTC → KST 기준으로 수정 |
| backup.ts | MEDIUM | `isBackupPathAvailable`: 쓰기 가능 여부(임시 파일 테스트) 검증 추가 |
| ManualReview.tsx | HIGH | 한글 인코딩 복원 + `onBadgeUpdate` 콜백으로 사이드바 배지 실시간 갱신 |
| App.tsx | MEDIUM | ManualReview 상태 처리 후 사이드바 review 배지 즉시 반영 |

### 2026-07-09 3차 전수 수정 목록

| 파일 | 심각도 | 수정 내용 |
|------|--------|-----------|
| repositories.ts | HIGH | `upsertOrderHeader`: 기존 주문 업데이트 시 수신인 정보(이름·연락처·주소·배송메모)도 갱신 — 배송지 변경 반영 |
| orchestrator.ts | HIGH | `importEzadminInvoice`: `if (true) {}` 불필요 래핑 제거 |
| handlers.ts | HIGH | `invoice:importEzadmin` / `invoice:uploadToever`: `app_run` 기록 추가 — 자동화 실행 이력 누락 수정 |
| handlers.ts | HIGH | `app:isFirstRun`: `require()` 동적 임포트 → 정적 import로 교체 |
| handlers.ts | HIGH | 전체 `mainWindow.webContents.send` → `mainWindow?.webContents.send` null 안전 처리 |
| main.ts | MEDIUM | `activate` 핸들러: 창 재생성 후 IPC 핸들러·스케줄러 재등록 |
| scheduler.ts | MEDIUM | `isWorkday`: `date.getDay()` 로컬 시간 → KST 기준 요일로 수정 |
| browserManager.ts | MEDIUM | `isChromiumInstalled`: 폴더 존재 체크 → 실행 파일(`chrome.exe` 등) 실제 존재 확인으로 강화 |

### 아키텍처 원칙 (재확인)
- 모든 날짜 관련 로직: getKSTDateString() 사용 (UTC 금지)
- DB 상태 변경이 포함된 로직: 반드시 트랜잭션 사용
- 수동검토 삽입 전: hasOpenReview() 체크로 중복 방지
- 배치 취소 주문: 동일 내용이면 재출고 허용, 변경이면 수동검토
- 이지어드민 export: `ezadmin_batch_id` 반드시 order_header에 연결
- 백업 경로: 쓰기 가능 여부 실제 테스트로 확인
- 자동화 실행(import/upload 포함): 반드시 app_run 기록
- mainWindow 접근: 항상 optional chaining (`mainWindow?.`)으로 null 안전 처리