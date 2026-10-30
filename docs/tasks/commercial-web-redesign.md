# 상용 웹서비스 수준 전면 재디자인 (모던 에디토리얼 북클럽 & 집중형 리딩)

## 과업과 승인 근거

- 과업: 외부 방문자와 학습자가 첫 화면(`/`)·목록(`/reading/`, `/prep/`, `/practice/`)·이야기 읽기(`/reading/<id>/`)·사전 훈련(`/prep/<작품>/unit-<n>/`)·장면 연습(`/practice/have/`)·문장 해설기(`/ask/`)를 이용할 때, 내부 문서 색인이나 개발용 분할 도구가 아니라 완성도 높은 **상용 영어 리딩·감각 학습 웹서비스**로 경험하게 한다.
- 승인 근거: 2026-10-30 강PD가 “상용 웹페이지로 느껴지지 않는군 재디자인 검토하라. 기존 레이아이웃등 보존할필요없다.”라고 지시하고, 이어 세 가지 핵심 디자인 축을 승인했다:
  1. **수업·이야기 읽기 레이아웃**: **에디토리얼 집중형 + AI 슬라이드 드로어** — 좌우 고정 패널을 치우고 이야기·문제 본문을 중앙에 넓게 배치하며, AI 질문·목차는 누를 때만 열리는 우측 패널/인라인으로 전환.
  2. **홈(`/`) 및 목록 구성**: **히어로 배너 + 작품 탭 필터(전체/입문/Wonder/영화) + 2~3열 스토리 카드 그리드 + 하단 기본동사·해설기 쇼케이스**.
  3. **시각 톤앤매너**: **모던 에디토리얼 북클럽 톤** — 따뜻한 아이보리 배경(`#FAF8F5`) + 순백색 입체 카드(`#FFFFFF`) + 딥 잉크/포레스트 포인트(`#1B4332`, `#141E16`) + 큼직한 영문 세리프(`Newsreader`) & 선명한 한글 타이포그래피.
- 현재 구현:
  - 공개 페이지(`app/public-pages.css`, `components/site-shell.tsx`, `components/study-pages.tsx`)는 상단 탐색과 중복되는 좌측 사이드바(`.public-outline`)가 화면 좌측 220px을 차지하고, 15편 이야기와 13개 유닛이 밑줄만 그어진 1열 텍스트 행(`.link-card`)으로 길게 나열되어 문서 색인처럼 보인다.
  - 수업 화면(`components/workspace-shell.tsx`, `app/workspace.css`)은 데스크톱에서 좌측 목차(200px) + 중앙 본문 + 우측 빈 AI 대화창(40%)의 3분할 격자로 고정되어, 정작 주인공인 이야기 본문이 좁은 칸에 눌려 있고 상단에 시스템 상태 줄(`.lw-session-status`)이 상시 노출된다.
- 이번 물음과 기대: 기존 레이아웃 제약을 걷어내고 모던 에디토리얼 북클럽 시각 체계, 반응형 카드 그리드·작품 필터 탭, 중앙 집중형 에디토리얼 리딩 화면 + 온디맨드 AI 드로어로 전면 개편하면 상용 리딩 플랫폼 수준의 첫인상과 읽기 몰입감을 얻을 수 있는가.
- 기대의 근거: `knowledge/domain/web-app-ux-design.md` 관계 1·4·6·11·15, `knowledge/domain/web-app-production.md` 관계 1·5·7.
- 실행이 모델을 따랐는지 가를 관찰: 홈(`/`)에서 카테고리 탭 필터와 카드 그리드로 이야기를 고르고, `/reading/<id>/`에서 중앙 에디토리얼 본문으로 읽고 문제를 푼 뒤, 질문이 필요할 때 AI 드로어를 열어 질문하는 전체 흐름을 데스크톱(1440px, 1100px)과 모바일(390px, 320px)에서 확인한다. 상용 웹서비스다운 인상과 가독성은 강PD가 실제 화면을 보고 판단한다.

## 시작과 끝

- 시작 상황: 사용자가 홈(`/`), 이야기 목록(`/reading/`), 또는 개별 이야기(`/reading/<id>/`)로 진입한다.
- 사용자 행동과 서비스 반응:
  1. **홈(`/`) 및 이야기 목록(`/reading/`)**: 상단 에디토리얼 히어로 배너에서 대표 이야기를 바로 시작하거나, `전체 (15) · 입문·감각 이야기 (2) · Wonder (9) · 영화 명장면 (4)` 탭 필터로 원하는 작품을 골라 2~3열 입체 스토리 카드 그리드에서 이야기를 선택한다. 각 카드 하단에서는 짝 사전 훈련 유닛으로도 바로 이동한다.
  2. **이야기 읽기(`/reading/<id>/`) 및 수업 화면**: 첫 진입 시 좌측 목차와 우측 빈 AI 창이 본문을 가로막지 않고, 따뜻한 아이보리 배경(`#FAF8F5`) 중앙에 놓인 순백색 에디토리얼 시트(`max-width: 880px`)에서 큼직한 영문 세리프 본문과 문제 카드에 몰입한다.
  3. **목차 및 AI 튜터 드로어**: 상단 툴바의 `목차` 단추를 누를 때만 목차 패널이 열리고, 문제의 `이 문제에 질문하기`·`AI에게 설명 요청`이나 상단 `AI 튜터` 단추를 누를 때 우측 AI 슬라이드 패널(좁은 화면에서는 하단 대화 영역)이 열려 질답을 이어 간다. 패널의 `콘텐츠로 이동`·`패널 접기`로 언제든 중앙 집중 읽기 모드로 돌아온다.
- 기대 결과: 모든 공개 페이지와 수업 화면이 일관된 모던 에디토리얼 북클럽 디자인으로 표시되고, 기존 50개 주소·메타데이터·구조화 데이터·정본 판정·AI 질문·브라우저/서버 기록 복원·펜 노트가 회귀 없이 동작한다.
- 이번 범위 밖: 학습 정본(`content/reading.json`, `content/prep.json`) 문항·정답 데이터 변경, API 계약 변경.

## 수용 조건과 증거

| 조건 | 성립해야 할 동작 | 필요한 입력·생성·상태 경로 | 검증 방법과 관찰 대상 | 실제 실행·관찰 근거와 판 | 결과와 남은 한계 |
| --- | --- | --- | --- | --- | --- |
| 홈·목록 카드 그리드와 작품 탭 필터 | 홈(`/`)과 `/reading/`에서 히어로 배너, 카테고리 탭 필터(`전체`, `입문·감각 이야기`, `Wonder`, `영화 명장면`), 2~3열 스토리 카드 그리드(15편)와 짝 유닛 연결(13개)이 동작하고, 초기 HTML에 15편 전체 링크가 포함됨 | `components/study-pages.tsx`, `components/story-catalog-tabs.tsx`, `app/public-pages.css` | 첫 HTML 링크 확인 및 브라우저에서 카테고리 필터 전환·카드 그리드 배치·짝 유닛 이동 확인 | `tests/e2e/site-design.spec.ts` 및 `tests/e2e/study-content.spec.ts` 통과 (`main`分支, 2026-10-30) | 충족 |
| 에디토리얼 집중형 리딩 & AI/목차 드로어 | 수업 화면(`/reading/<id>/`, `/prep/<작품>/unit-<n>/`, `/practice/have/`) 첫 진입 시 본문이 중앙 에디토리얼 컬럼으로 넓게 표시되고, `목차`와 `AI 튜터`(`이 문제에 질문하기` 포함) 조작 시에만 좌우 패널/대화가 열리며 닫기로 접을 수 있음 | `components/workspace-shell.tsx`, `app/workspace.css`, `components/story-workspace.css`, `components/card-lesson.css` | 1440·1100·390·320px에서 본문 중앙 배치, 목차 열기/닫기, AI 질문하기 클릭 시 우측 패널 전개 및 가림·가로 넘침 없음 확인 | `tests/e2e/site-design.spec.ts`, `tests/e2e/story-lessons.spec.ts`, `tests/e2e/card-lesson.spec.ts`, `tests/e2e/content-chat-workspace.spec.ts` 통과 (2026-10-30) | 충족 |
| 모던 에디토리얼 북클럽 시각 체계 | 아이보리 배경(`#FAF8F5`), 순백색 입체 카드(`#FFFFFF`), 딥 포레스트 포인트(`#1B4332`), 영문 `Newsreader` 세리프·한글 산세리프 위계가 공개 페이지와 수업 화면 전체에 일관되게 적용되고 상단 중복 사이드바(`.public-outline`)와 상단 디버그성 상태 줄이 정리됨 | `app/globals.css`, `app/public-pages.css`, `app/workspace.css`, `components/site-shell.tsx` | 대표 화면(홈, 이야기 목록, 이야기 읽기, 사전 훈련 유닛, 문장 해설기) 시각 점검 및 E2E 전체 회귀 검사 | `tests/e2e/site-design.spec.ts`, `tests/e2e/notes.spec.ts`, `tests/e2e/reading-levels.spec.ts` 통과 (2026-10-30) | 충족 |
| 기존 기능·보안·메타데이터 회귀 없음 | 50개 공개 URL HTTP 200·메타·JSON-LD·사이트맵, 이야기·카드 정답 비공개 경계, 시간 제한 읽기, 서버 판정, AI 질문, 펜 노트, 기록 복원이 모두 유지됨 | 기존 서버·클라이언트 상태 경계 | 단위 테스트 전체(`npm test`), Playwright E2E, `npm run cf:build` | `npm test` 242/242 통과, `npm run cf:build` 54개 정적 페이지 및 OpenNext 번들 생성 통과, Playwright E2E 통과 (2026-10-30) | 충족 |

## 서비스 정책

| 정책 | 채택 / 미지원 / 미결 | 승인한 의미·담당 문서 | 현재 관찰과 남은 조건 |
| --- | --- | --- | --- |
| 중앙 에디토리얼 집중형 수업 레이아웃 | 채택 | 수업 첫 화면은 좌우 고정 사이드바 없이 본문 시트를 중앙에 배치하고, 목차와 AI 대화는 사용자 조작 시 열거나 접는다 (`docs/ux-design.md`) | 이번 구현에서 `WorkspaceFrame`과 `app/workspace.css`로 반영 |
| 홈·이야기 목록의 작품 탭 필터와 카드 그리드 | 채택 | 초기 상태(`전체`)에서 15편 전체를 카드 그리드로 노출해 검색 크롤링과 즉시 탐색을 보장하고, 클라이언트 탭으로 작품별 필터링을 제공한다 | 이번 구현에서 `StoryCatalogSection`으로 반영 |
| 공개 페이지 중복 좌측 사이드바 제거 | 채택 | 상단 GNB(`SiteHeader`)로 공통 탐색을 일원화하고 기존 `.public-outline` 좌측 고정 칼럼은 제거한다 | 이번 구현에서 `components/site-shell.tsx`와 `app/public-pages.css`로 반영 |

## 사용자 경험·디자인

- 판단 단위와 맥락:
  - 홈(`/`)과 목록 페이지: 최대 폭 `1160px` 중앙 컨테이너. 상단 다크 포레스트/웜 에디토리얼 히어로 배너 → 읽던 이야기 이어 보기 스포트라이트 → 작품 탭 필터 바 → 2~3열 반응형 스토리 카드 그리드(`repeat(auto-fill, minmax(320px, 1fr))`) → 사전 훈련 작품 카드 그리드 → 기본동사 감각 원리 카드 그리드 → 4단계 학습 가이드 카드 & 문장 해설기 배너.
  - 이야기 읽기·수업 화면: 최대 폭 `880px` 중앙 에디토리얼 본문 시트(`#FFFFFF`, 둥근 모서리 `16px`, 은은한 입체 그림자). 상단에는 반투명 블러 GNB 헤더(`.lw-toolbar`)만 두고, 임시 저장 상태(`.lw-session-status`)는 본문 흐름을 해치지 않도록 하단 상태 바로 내린다(저장 실패 시에만 경고 강조).
- 상태와 공개 시점:
  - 목차(`.lw-document-toc`): 첫 진입 시 접힌 상태(`outlineCollapsed: true`)로 시작해 본문 시야를 가리지 않는다. 툴바의 `목차` 단추를 누르면 좌측 슬라이드/플로팅 드로어로 열리고, 항목을 고르거나 `Escape`·`목차 접기`를 누르면 닫힌다.
  - AI 튜터 대화(`.lw-chat-pane`): 첫 진입 시 우측 분할을 차지하지 않고 본문 하단 스튜디오 섹션으로 대기한다. 사용자가 문제의 `이 문제에 질문하기`·`AI에게 설명 요청`, 툴바의 `AI 튜터`, 또는 `대화로 이동`을 누르면 데스크톱(`>= 1100px`)에서 우측 슬라이드 드로어(`data-chat-open="true"`)로 본문 옆에 나란히 열려 본문과 대화를 함께 보며 질문할 수 있고, `패널 접기`로 언제든 다시 닫을 수 있다.
- 의미 역할과 시각 위계:
  - 배경 `#FAF8F5`(Warm Ivory), 표면 `#FFFFFF`(Crisp Paper), 텍스트 `#141E16`(Deep Ink), 보조 텍스트 `#4E5D52`, 주 강조색 `#1B4332`(Deep Editorial Forest), 보조 강조색 `#9C4221`(Warm Terracotta).
  - 영어 본문·제목은 `Newsreader` 세리프(`19px/1.9`), 한국어 UI·해설은 `Pretendard`/시스템 산세리프(`15px~16px/1.75`)로 대비를 분명히 한다.
- 조작·접근성:
  - 1440·1100·390·320px 모든 폭에서 가로 스크롤이 발생하지 않고, 모든 단추·탭·카드 링크가 최소 높이 `44px`와 명확한 `:focus-visible` 외곽선을 유지한다.

## 구조 영향

- 영향: **constrain** (기존 서버·클라이언트 데이터 및 상태 소유권은 그대로 두고, `SiteOutline`·`StudyPartView`·`WorkspaceFrame`의 레이아웃·스타일 표현 계층만 재구성).
- 현재 소유자와 의존성:
  - 공개 목록과 홈 화면: `components/study-pages.tsx`, `components/site-shell.tsx`, `app/public-pages.css`
  - 수업 공통 틀: `components/workspace-shell.tsx`, `app/workspace.css`, `components/story-workspace.css`, `components/card-lesson.css`
- 검증 방법: 단위 테스트(`npm test`), Playwright E2E 전체(`npx playwright test`), Cloudflare Workers 빌드(`npm run cf:build`).

## 사람이 정할 질문

- 새로 정할 선택: 없음 (강PD가 3개 핵심 디자인 축을 모두 확정함).
- 사용 뒤 판단할 질문: 개편된 홈 카드 그리드와 중앙 집중형 이야기 읽기 화면이 상용 웹서비스답게 정돈되고 읽기 편한가.
- 실제 응답: 2026-10-30 강PD가 에디토리얼 집중형 + AI 슬라이드 드로어(A1), 히어로 배너 + 작품 탭 필터 + 2~3열 스토리 카드 그리드(A2), 모던 에디토리얼 북클럽 톤(A3)을 선택함.

## 결과

- 확인한 범위:
  - 단위 테스트 `npm test` (242개) 통과
  - Cloudflare Workers 프로덕션 번들 `npm run cf:build` (54개 정적 페이지 및 OpenNext Worker 번들) 통과
  - Playwright E2E(`site-design.spec.ts`, `story-lessons.spec.ts`, `card-lesson.spec.ts`, `content-chat-workspace.spec.ts`, `unified-input-workspace.spec.ts`, `study-content.spec.ts`, `notes.spec.ts`, `reading-levels.spec.ts`, `card-recall.spec.ts`) 통과
- 미충족·미확인 조건: 실제 화면의 상용 완성도와 가독성은 강PD가 확인 후 최종 판단한다.
