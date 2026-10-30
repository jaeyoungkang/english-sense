# 이야기 읽기 중심 웹앱 전체 구조 재설계 작업 계약

[학습 서비스 범위](../learning-service.md), [웹 UX 설계](../ux-design.md), [현재 아키텍처](../architecture.md), [외부 공개 읽기 서비스 계약](public-reading-service.md)을 바탕으로, **이야기 읽기(15편)**를 웹앱의 1순위 메인 콘텐츠로 세우고 홈 화면(`/`), 전역 탐색(상단 막대·왼쪽 목차·수업 목록 창), 이야기↔사전 훈련 양방향 연결, 기존 `have` 장면 작업 공간(`/practice/have/`)의 위치를 재설계하는 작업 계약이다.

## 승인된 결정 (강PD 확정)

1. **홈(`/`)의 역할 전환과 `have` 장면 작업 공간 분리:**
   - 첫 화면(`/`)을 **‘이야기 읽기 메인 허브’**로 개편한다. 방문자가 `/`에 들어오면 바로 시작할 수 있는 대표 이야기·이어 읽기와 전체 이야기 15편(기본 감각 이야기 2편 + 작품 짝 이야기 13편)이 중심에 놓인다.
   - 기존 홈(`/`)에 있던 대화형 `have` 장면 작업 공간(`LearningWorkspace`, `lessonId: "titanic-have"`)은 `/practice/have/`로 옮겨 모든 기능과 기록(`english-sense-learning-workspace-v3` 및 서버 개인 기록 `scope: "titanic-have"`)을 그대로 보존한다. 정적 장면 퀴즈 `/practice/titanic/have/`도 기존 주소 그대로 유지한다.
2. **전역 탐색(상단 탐색 막대·왼쪽 목차·수업 목록 창) 위계 재편:**
   - 상단 탐색 막대(`SiteNavigation`), 공개 페이지 왼쪽 목차(`SiteOutline`), 수업 목록 대화상자(`LessonListDialog`) 모두 1순위를 **‘이야기 읽기’**로 통일한다.
   - 전체 학습 메뉴 순서를 **`이야기 읽기` → `책·영화 사전 훈련 카드` → `기본동사 감각·장면 연습` → `문장 해설기`** 순으로 정렬한다.
3. **이야기 읽기(15편) ↔ 사전 훈련 유닛(13개) 양방향 연결 강화:**
   - 홈(`/`)과 이야기 목록(`/reading/`)의 작품 짝 이야기마다 ‘이야기 읽기’ 카드와 함께 **‘짝 사전 훈련 유닛 표현 카드 연습’** 링크를 나란히 제공한다.
   - 작품별 사전 훈련 목록(`/prep/<work>/`)과 카드 수업 화면(`/prep/<work>/unit-<n>/`)에서도 **‘이 유닛의 표현으로 쓴 짝 이야기 읽기’**로 바로 넘어가는 안내를 상단과 하단에 함께 둔다(카드 회상 게이트 불변식은 그대로 지킨다).

## 사용자와 과업

- **주 사용자:** 검색이나 직접 방문으로 웹앱 첫 화면(`/`)이나 이야기 페이지(`/reading/<id>/`)에 들어와 영어 이야기를 읽고 퀴즈를 풀며 영어 감각을 익히는 방문자·학습자.
- **핵심 과업:**
  1. 방문자가 홈(`/`)에 들어오면 웹앱의 중심 콘텐츠인 **이야기 읽기 15편**을 한눈에 파악하고, 읽던 이야기를 이어 보거나 추천 입문 이야기(`The Green Umbrella`, `Morning on Oak Street`) 또는 작품별 짝 이야기(*Wonder*, *Groundhog Day*, *Zootopia*, *Inside Out*, *The Intern*)를 골라 바로 읽기와 7문항 풀이를 시작한다.
  2. 작품별 이야기를 읽기 전이나 읽은 뒤에 같은 자리에 안내된 **짝 사전 훈련 유닛(`/prep/<work>/unit-<n>/`)**으로 이동해 핵심 표현을 빈칸 카드로 떠올려 보거나, 반대로 사전 훈련 유닛에서 짝 이야기로 곧장 넘어와 이야기 문맥 속에서 표현을 확인한다.
  3. 이야기에서 자주 만나는 기본동사(`have`, `get`, `be`, `go`, `come`)의 감각 원리와 장면 연습(`/practice/have/` 대화형 작업 공간 및 `/practice/titanic/<word>/`), 자유 문장 해설기(`/ask/`)를 보조 훈련 도구로 오가며 학습한다.

## 수용 조건

- **`home-story-reading-hub` (홈 `/` 이야기 읽기 메인 허브 개편):**
  - `/` 첫 응답 HTML과 화면이 `.public-app` 공통 셸 안에서 **이야기 읽기 메인 허브**를 그린다.
  - 머리말(Hero)에서 첫 이야기 바로 읽기(`/reading/green-umbrella/`), 전체 이야기 탐색(`#stories-h`), 문장 해설기(`/ask/`)로 바로 이동할 수 있다.
  - 이 브라우저에 읽거나 풀던 이야기 기록(`english-sense-lesson-v4:<storyId>`)이 있으면 홈 상단에 **읽던 이야기 이어 보기**를 보여 주고, 기록이 없을 때도 아무 저장소 키나 API 요청을 만들지 않는다.
  - 입문 감각 이야기 2편(`#stories-h`)과 작품별 짝 이야기 13편(`#paired-h`)을 모두 표시하고, 하단에 사전 훈련(`/prep/`), 기본동사 감각 표제어(`#words`), 학습 방법(`#how-h`), 문장 해설기(`#tool-h`)를 연결한다.
- **`scene-workspace-at-practice-have` (`have` 장면 작업 공간 `/practice/have/` 이동 및 호환 유지):**
  - `/practice/have/`에서 기존 `LearningWorkspace`(`lessonId: "titanic-have"`)가 열리고, 7개 장면 퀴즈·감각 자료 스택·문서 내 첫 답/수정·옆 대화·펜 노트·개인 서버 기록 동기화가 이전과 동일하게 동작한다.
  - 기존 `/practice/titanic/have/` 정적 퀴즈 페이지도 그대로 유지되어 사이트맵과 정적 퀴즈 경로가 깨지지 않는다.
  - `/practice/`, `/practice/titanic/`, `/have/`, 수업 목록 창에서 `/practice/have/`(`have 장면 작업 공간`)로 이동할 수 있다.
- **`story-first-navigation` (전역 탐색 1순위 ‘이야기 읽기’ 재편):**
  - 상단 탐색 막대(`SiteNavigation`)에 `이야기 읽기`(`href="/reading/"`) 바로가기 링크가 1순위로 자리 잡고, 그 뒤에 `수업 목록`, `감각 자료`, `문장 해설기`가 이어진다.
  - `수업 목록` 대화상자(`LessonListDialog`)의 섹션 순서가 **`이야기 읽기 · 15편` → `책·영화 사전 훈련 · 유닛 13개` → `기본동사 장면 연습`** 순으로 배치된다.
  - 공개 페이지 왼쪽 목차(`SiteOutline`)의 `학습하기` 그룹이 **`이야기 읽기 홈(/)` → `이야기 전체 목록(/reading/)` → `책·영화 사전 훈련(/prep/)` → `기본동사 장면 연습(/practice/)` → `문장 해설기(/ask/)`** 순으로 배치된다.
- **`bidirectional-story-prep-links` (이야기 ↔ 사전 훈련 유닛 양방향 연결):**
  - `/`와 `/reading/`의 작품별 짝 이야기 13편마다 이야기 카드 아래에 짝 사전 훈련 유닛(`/prep/<work>/unit-<n>/`)으로 바로 가는 링크(`.story-pair-unit-link`)가 있다.
  - `/prep/<work>/` 작품 페이지의 각 유닛 항목 아래에 짝 이야기(`/reading/<storyId>/`)로 바로 가는 링크(`.story-pair-unit-link`)가 있으며, 닫힌 카드의 표현 이름을 노출하지 않는다.
  - `/prep/<work>/unit-<n>/` 카드 수업 문서 상단에도 짝 이야기 바로가기 안내(`.pair-note`)가 표시되어 문서 상단·하단 양쪽에서 짝 이야기로 이동할 수 있다.

## 화면·구조 영향

- **라우팅·페이지 구성 (`content/pages.json`, `lib/content.ts`, `lib/server/study-source.ts`, `app/[[...slug]]/page.tsx`, `lib/lesson-registry.ts`):**
  - `content/pages.json`: 홈(`path: ""`)의 메타데이터와 구성을 이야기 읽기 메인 허브(`{ "kind": "reading-hub" }`)로 갱신하고, `/practice/` 및 `/practice/titanic/`, `/have/` 본문에 `/practice/have/`(AI 대화형 `have` 장면 작업 공간) 안내를 더한다.
  - `lib/lesson-registry.ts`: `ARTIFACT_LESSON_ID`(`titanic-have`)의 `path`를 `"/practice/have/"`로 갱신한다.
  - `lib/server/study-source.ts`: `practice/have/` 페이지를 공개 페이지 목록(`studyPages()`)에 등록해 메타데이터·캐노니컬 URL·사이트맵에 포함시킨다.
  - `app/[[...slug]]/page.tsx`: `page.path === "practice/have/"`일 때 `<LearningWorkspace />`를 렌더링하고, `page.path === ""`일 때는 공개 셸(`.public-app`) 안에서 `StudyPartView`의 `reading-hub`를 렌더링한다.
- **탐색·목록 컴포넌트 (`components/site-navigation.tsx`, `components/site-shell.tsx`, `components/lesson-list-dialog.tsx`, `components/study-pages.tsx`, `components/card-lesson.tsx`):**
  - `components/site-navigation.tsx`: 상단 탐색 막대에 `이야기 읽기`(`/reading/`) 링크를 첫 번째 항목으로 추가한다.
  - `components/site-shell.tsx`: 왼쪽 목차(`SiteOutline`)의 순서를 이야기 읽기 중심으로 재배치한다.
  - `components/lesson-list-dialog.tsx`: 섹션 순서를 이야기 읽기 → 사전 훈련 → 장면 연습 순으로 바꾸고 `/practice/have/` 장면 작업 공간 링크를 안내한다.
  - `components/study-pages.tsx`: `ReadingHub`(홈 `/`), `ReadingList`(`/reading/`), `PrepWorkPage`(`/prep/<work>/`)에 양방향 짝 링크와 홈 이어 읽기(`ContinueReadingBanner`)를 구현한다.
  - `components/card-lesson.tsx`: 카드 수업 문서 머리말 아래에 `.pair-note`로 짝 이야기 바로가기를 추가한다.

## 검증 계획

- **단위 검증 (`npm test`):**
  - `tests/lesson-list.test.ts`, `tests/lesson-catalog.test.ts`, `tests/card-recall.test.ts`, `tests/story-lesson-page.test.ts`를 실행해 레지스트리 경로(`/practice/have/`), 수업 목록 창 렌더링, 정본 비노출·회상 게이트 불변식을 확인한다.
- **브라우저 E2E 검증 (`npm run test:e2e`):**
  - 홈(`/`)이 이야기 읽기 메인 허브로 열리고, 15편 이야기와 짝 사전 훈련 유닛 링크·감각 표제어·해설기 이동이 동작하며, 열람만으로 학습 기록이나 API 호출을 만들지 않는지 확인한다.
  - `/practice/have/`에서 `LearningWorkspace`의 모든 기존 E2E 시나리오(7문항 풀이, AI 피드백, 문서·대화 배치, 펜 노트, 개인 서버 보관 등)가 통과하는지 확인한다.
  - 상단 탐색 막대·왼쪽 목차·수업 목록 창의 순서와 양방향 링크(`/reading/` ↔ `/prep/`)가 데스크톱과 모바일(320px/390px)에서 가로 넘침 없이 동작하는지 확인한다.
- **빌드·런타임 검증 (`npm run check`, `npm run cf:build`):**
  - 전체 정적·동적 라우트 빌드와 Cloudflare Worker 번들 생성이 통과하는지 확인한다.
