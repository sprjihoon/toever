# Spring Toever Ops

투에버(Toever Support) ↔ 이지어드민(Ezadmin) 간의 주문 수집·처리·송장 업로드 업무를 자동화하는 Windows 데스크톱 프로그램입니다.

---

## 기술 스택

| 영역 | 기술 |
|------|------|
| 프레임워크 | Electron 28 + React 18 + TypeScript |
| 번들러 | Vite 6 |
| DB | SQLite (better-sqlite3, WAL 모드) |
| 브라우저 자동화 | Playwright |
| 엑셀 파싱/생성 | SheetJS (xlsx) |
| 스케줄러 | node-cron |
| 비밀번호 암호화 | Electron safeStorage (Windows DPAPI) |

---

## 개발 시작

```bash
# 의존성 설치
npm install

# Playwright 브라우저 설치 (최초 1회)
npm run install:playwright

# 개발 서버 실행
npm run dev

# 빌드
npm run build
```

---

## 핵심 원칙

### 1. 주문번호 / 송장번호 = 반드시 문자열

- 모든 ID(주문번호, 발주번호, 송장번호)는 **string 타입**으로만 처리
- 앞자리 `0` 손실, 과학적 표기법(`1.00012E+17`) 변환 완전 방지
- `XLSX.utils.sheet_to_json({ raw: false })` 또는 HTML 직접 파싱으로 처리

### 2. 이지어드민 자동화 금지

- 이지어드민은 직원이 **수동**으로 로그인/업로드/출고 처리
- 프로그램은 **업로드용 파일 생성**과 **송장 파일 import**만 담당

### 3. 원본 파일 보존

- 투에버 다운로드 원본 → `raw/toever_orders/`
- 이지어드민 송장 원본 → `raw/ezadmin_invoice/`
- 생성 파일 → `generated/ezadmin_upload/`, `generated/toever_invoice_upload/`
- 파일 덮어쓰기 금지, 타임스탬프 파일명으로 저장

### 4. 중복 출고 방지

- 이미 `EXPORTED_TO_EZADMIN` 이상의 상태인 주문은 재처리 금지
- 같은 주문번호에 내용 변경 감지 → `ORDER_CHANGED_REVIEW` 상태로 수동검토 큐 이동
- 이지어드민 파일 import 시 파일 SHA256 해시로 중복 import 방지

### 5. 투에버 로그인 정책

- 업무 시작 전 기존 세션 유효성 먼저 확인 (이미 로그인 상태면 재로그인 안 함)
- 세션 만료 시 저장된 ID/PW로 자동 로그인
- 로그인 실패 시 최대 **1회** 재시도 후 중단 (계정 잠금 5회 초과 방지)
- 비밀번호는 Windows DPAPI(`safeStorage`)로 암호화 저장, 코드에 평문 없음

---

## 스토리지 구조

```
D:\SpringToeverOps\                       ← 기본 저장소
  database\
    toever_ops.db                         ← SQLite DB (WAL 모드)
  raw\
    toever_orders\                        ← 투에버 주문 다운로드 원본
    ezadmin_invoice\                      ← 이지어드민 송장 파일 원본
  generated\
    ezadmin_upload\                       ← 이지어드민 업로드용 xlsx 생성
    toever_invoice_upload\                ← 투에버 송장 업로드용 xls 생성
    reports\                              ← 리포트
  pdf\
    contracts\                            ← 출력물 PDF
  logs\
    automation\                           ← 자동화 실행 로그
    screenshots\                          ← 오류/로그인 스크린샷

E:\SpringToeverOpsBackup\                 ← 외장 SSD 백업 (날짜/시각별 폴더)
  2026\07\08\20260708_173000\
    database\
      toever_ops.db                       ← SQLite backup API로 안전하게 복사
    raw\...
    generated\...
    logs\...
```

---

## 업무 흐름

```
[투에버 서포트]
   ↓ 자동 로그인 + 주문 엑셀 다운로드 (Playwright)
[Ordering_data.xls]
   ↓ HTML 파싱 (CP949, x:str 셀 text 강제)
[DB 저장 + 중복 필터링]
   ↓ NEW_SHIPMENT_TARGET 추출
[260708(날짜).xlsx 생성]  ← Ordering_data 시트, 10컬럼
   ↓ 직원 수동 이지어드민 업로드
[이지어드민]
   ↓ 직원 수동 출고 처리 + 확장주문검색 다운로드
[확장주문검색_*.xls]  ← HTML UTF-8, 60컬럼
   ↓ HTML 파싱 + 주문번호 기준 송장 매칭
   ↓ 복수 송장 → 수동검토 / 단일 송장 → DB 반영
[upload_form.xls 생성]  ← Sheet1: 주문번호/송장번호 (BIFF8)
   ↓ Playwright로 투에버 자동 업로드
[투에버 서포트]  ← 송장 업로드 완료
```

---

## 파일 포맷 규칙

| 파일 | 포맷 | 인코딩 | 파싱 방법 |
|------|------|--------|-----------|
| `Ordering_data.xls` (투에버 주문) | HTML_XLS | CP949 (KSC5601) | HTML 직접 파싱 |
| `확장주문검색_*.xls` (이지어드민 송장) | HTML_XLS | UTF-8 | HTML 직접 파싱 |
| `260708(1).xlsx` (이지어드민 업로드 양식) | XLSX | UTF-8 | SheetJS |
| `upload_form.xls` (투에버 송장 업로드 양식) | BIFF8 XLS | CP949 | SheetJS + DPAPI |

> **XLSX 라이브러리 주의**: `Ordering_data.xls`를 XLSX 라이브러리로 파싱하면 주문번호 `0100012026070800002`가 `1.00012E+17`로 변환됩니다. 반드시 HTML 직접 파싱(`htmlTableParser.ts`)을 사용해야 합니다.

---

## DB 스키마 요약

| 테이블 | 설명 |
|--------|------|
| `order_header` | 투에버 주문 헤더 (주문번호, 수령자, 상태) |
| `order_item` | 주문 상품 라인 (다중 상품 지원) |
| `invoice_event` | 송장 이력 |
| `ezadmin_export_batch` | 이지어드민 업로드 배치 |
| `file_artifact` | 파일 SHA256 및 경로 |
| `manual_review_queue` | 수동검토 항목 |
| `toever_action_log` | Playwright 액션 로그 |
| `backup_history` | 백업 이력 |
| `app_run` | 자동화 실행 이력 |
| `app_settings` | 설정값 (key-value) |

---

## 보안

- 비밀번호: `safeStorage.encryptString()` (Windows DPAPI) → Base64로 DB 저장
- 코드에 ID/PW 하드코딩 없음
- 비밀번호 평문 노출 없음 (설정 화면에서도 `type="password"`)

---

## 백업

대시보드 → **지금 백업하기** 버튼:

1. 실행 중인 자동화 확인 (경고 표시)
2. 외장 SSD 경로 접근 확인 (없으면 중단, 업무 데이터 보호)
3. SQLite DB: `db.backup()` API로 온라인 안전 백업
4. 파일: 날짜/시각 폴더로 복사
5. 결과: `backup_history` 기록

자동 백업: 스케줄러가 마감 시간(기본 17:30, 영업일)에 자동 실행

---

## 개발 메모

- `tsconfig.node.json`: Electron main process 설정
- `tsconfig.json`: React renderer 설정
- `electron/services/`: 모든 비즈니스 로직 (파서, DB, 백업, 스케줄러)
- `src/pages/`: React UI 페이지
- `shared/types.ts`: main/renderer 공유 타입

---

*Spring Toever Ops v1.0.0 — 2026*
