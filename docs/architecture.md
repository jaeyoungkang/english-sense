# 영어 감각의 현재 아키텍처

이 문서는 선택한 구조와 현재 실행 경로를 소유한다. 일반 원리는 `knowledge/domain/web-app-architecture.md`,
제품 약속은 `docs/learning-service.md`, 실행 명령과 설정은 `README.md`가 소유한다.

## 현재 책임과 의존 방향

| 담당 위치 | 현재 책임 | 경계 | 지키는 방법 |
| --- | --- | --- | --- |
| `content/`, `lib/content.ts` | 공개 학습 콘텐츠와 페이지 조회 | 개인 학습 상태를 담지 않는다 | (리뷰) |
| `app/[[...slug]]/page.tsx` | 정적 페이지·메타데이터와 컴포넌트 조합. 홈은 장면 수업, `/reading/<id>/`는 이야기 수업, `/prep/<작품>/unit-<n>/`은 카드 수업의 작업 공간을 그린다. 목록 페이지(`/reading/`·`/prep/`·`/prep/<작품>/`)는 목록용 공개 요약으로 그린다 | 미리 만든 콘텐츠를 브라우저에 보인다. 이야기·카드 페이지는 `getPublicLesson`·`getStoryLessonLinks`·`getCardLessonView`의 공개 투영만, 목록과 홈의 수업 목록 창은 `getStudyListing`·`getLessonListing`의 요약만 넘긴다 | (검사: `npm run test:e2e`) |
| `components/` | 그림 전환·퀴즈·해설기 입력과 응답 표시 | 비밀키나 Cloudflare 바인딩을 가져오지 않는다 | (리뷰) |
| `components/learning-workspace.tsx`, `app/workspace.css` | 장면 수업(`titanic-have`)의 작업 공간: 기록 v3·have 자료 스택·퀴즈 안의 첫 답(고르기·쓰기)과 수정 폼·AI 피드백과 질답 표시·판 대조·대화 요청 본문, 도구 막대의 "수업 목록" 창(`components/lesson-list-dialog.tsx`, 서버가 넘긴 `lessons`). 공유 셸의 칸을 채운다 | 정본 해설을 props로 넘기지 않고 제출·수정·초안·대화 출처와 발생 순서를 구분한다 | (검사: `npm run test:e2e`) |
| `components/workspace-shell.tsx` | 수업 종류에 상관없는 작업 공간 셸: 도구 막대·목차·콘텐츠 영역·옆 대화·상태 표시줄·대화 상자, 읽기 위치·목차·레이아웃·스크롤 복원 | 수업 기록·문항·답 형식·레지스트리를 모른다. 종류가 목차 항목, 문서 구역, 대화 맥락·타임라인·입력 폼·작성 칸, 대화 상자 내용을 칸으로 채운다. 참고 자료 스택은 `referenceStack`이 있을 때만 그린다 | (검사: `npm test`의 `tests/workspace-shell.test.ts`, `npm run test:e2e`) |
| `components/workspace-session.tsx` | 수업 기록의 브라우저 저장(`useRecordStore`: 읽기·저장·저장 실패 표시)과 대화 요청 수명주기(`useTurnRequests`: 한 번에 하나, 취소·70초 중단·실패 표시·늦은 응답 거절) | 기록의 모양과 요청 본문·응답 검사는 종류가 넘긴다. `learning-thread.ts`의 일반 reducer만 쓴다 | (검사: `npm run test:e2e`) |
| `components/workspace-chat.tsx` | 질문·응답·요청 상태·작성 칸의 공통 표시 | 대상 이름(`label`)을 받을 뿐 수업을 모른다 | (검사: `npm test`, `npm run test:e2e`) |
| `components/story-workspace.tsx`, `lib/story-lesson.ts` | 이야기 수업(`/reading/<id>/`)의 작업 공간: 읽기 구역(시작·벽시계 마감·끝 사건·본문 가림), 고르기 첫 답 폼, 설명 요청(문장은 `storyExplainRequestMessage`)·질문(대화 요청 `LessonChatRequest`). 기록·판정·옛 판 안내는 아래 `lesson-common.tsx`를 쓰고, 공유 셸의 칸을 채운다 | 브라우저에는 공개 투영만 받고(`PublicStoryLesson`) 정답·해설·근거는 판정 응답으로 첫 답 뒤에 받는다. 서버 모듈과 정본 JSON을 import하지 않는다. 판정 호출은 대화 턴 훅 밖에서 `acceptLessonCheck`로 요청 당시 대상과 맞을 때만 채택한다 | (검사: `npm test`의 `tests/story-lesson-page.test.ts`·`tests/import-direction.test.ts`, `npm run test:e2e`의 `tests/e2e/story-lessons.spec.ts`) |
| `components/card-lesson.tsx`, `components/card-lesson.css`, `lib/card-lesson.ts`, `lib/server/card-lesson-view.ts` | 카드 수업(`/prep/<작품>/unit-<n>/`)의 작업 공간: 카드마다 한 절의 문서(옛 `#<카드 id>` 해시 이동), 빈칸 입력·첫 답·수정(6회)·답 보기(첫 답 뒤에만), 설명 요청(`explainRequestMessage`)·질문. 서버가 넘기는 뷰(`CardLessonView`)는 공개 투영과 이웃 유닛·짝 이야기뿐이다. 공유 셸의 칸을 채운다 | `drill.answers`는 브라우저로 가지 않고 판정 응답(빈칸별 같음/다름)과 `reveal` 응답으로만 온다. 수정은 새 시도이고 첫 시도를 덮지 않는다 | (검사: `npm test`의 `tests/card-lesson.test.ts`, `npm run test:e2e`의 `tests/e2e/card-lesson.spec.ts`) |
| `components/lesson-common.tsx` | 이야기·카드 수업이 같게 만드는 것: 수업 기록 열기(`useLessonRecord`), 판정 요청의 전송·실패·다시 판정(`postLessonCheck`·`useLessonChecks`), "판정" 항목과 상태(`JudgementItem`·`JudgementLine`·`JudgementStatus`), 옛 판 기록 안내와 새 판 시작(`OldVersionNotice`), 도구 막대의 "수업 목록" 링크(`LessonListLink`) | 언제 보일지와 판정이 무엇을 말하는지는 종류가 정한다. 판정 요청은 20초에 중단하고, 응답은 요청 당시 대상과 맞을 때만 기록에 붙인다. 대화 응답의 대상 대조는 `lib/lesson-chat-contract.ts`의 `readLessonChatResponse`가 한 곳에서 한다 | (검사: `npm test`의 `tests/lesson-common.test.ts`, `npm run test:e2e`) |
| `lib/lesson-list.ts`, `components/lesson-list-dialog.tsx` | 홈 도구 막대 "수업 목록" 창의 이야기 15편·유닛 13개 제목과 기존 주소 | 서버가 목록용 공개 요약에서 만들어 props로 넘긴다. 문항 ID(약 350개)·카드·정답은 홈의 props와 번들에 없다. 창은 열 때만 그려진다 | (검사: `npm test`의 `tests/lesson-list.test.ts`, `npm run test:e2e`의 `tests/e2e/lesson-list.spec.ts`) |
| `lib/notes.ts`, `lib/note-blocks.ts`, `components/pen-notes.tsx`, `components/pen-notes.css` | 펜 노트(밑줄·형광펜·여백 메모): 노트의 모양·한도·검증·글에서 다시 찾기(`lib/notes.ts`, 순수), 수업마다 노트를 달 수 있는 글 블록의 키와 글(`lib/note-blocks.ts`, 공개 글만), 저장·선택 도구·메모·목록(`components/pen-notes.tsx`). 세 수업 화면이 글 요소를 `NoteBlock`으로 그리고 공유 셸의 `layer` 칸에 도구를 놓는다 | 수업마다 키 하나(`english-sense-notes-v1:<lessonId>`)에 저장하고 수업 기록(v3·v4)·문서 UI·레이아웃 키는 읽거나 쓰지 않는다. 노트는 요청·사건을 만들지 않고 AI 요청 본문에 들어가지 않는다. 저장 파일이 한 군데라도 어긋나면 그 수업의 노트만 버리고 안내한다. 블록 글은 React가 그린다(글 DOM을 직접 바꾸지 않는다) | (검사: `npm test`의 `tests/notes.test.ts`, `npm run test:e2e`의 `tests/e2e/notes.spec.ts`) |
| `lib/workspace-layout-state.ts` | 목차 접힘·채팅 읽기 위치·끝 따라가기 UI 설정 | 별도 키로 검사·복원하며 학습 기록·문서 자료 상태를 바꾸지 않는다 | (검사: `npm test`, `npm run test:e2e`) |
| `lib/document-workspace-state.ts` | 전체 공개 문서 투영·자료 추가 위치·펼침·목차 UI 상태. 참고 자료가 없는 수업은 `"plain"` 모드(자료 없음, 읽기 위치는 아무 문서 구역 ID) | 별도 키로 복원하며 학습 사건·수행을 바꾸지 않는다. 기본 모드는 have 문서의 모양과 검사 그대로다 | (검사: `npm test`, `npm run test:e2e`) |
| `lib/reference-materials.ts`, `lib/server/reference-materials.ts` | have·get·be·go 공개 감각 설명·예시 전달 | stage 공개 필드만 복사하며 정답·해설을 넘기지 않는다 | (검사: `npm test`) |
| `lib/learning-workspace-state.ts` | 문항별 수행·스레드와 전체 사건 순서·v3 복원 검사 | 스냅샷·대상·요청 식별을 분리하고 이전 키를 덮어쓰지 않는다 | (검사: `npm test`, `npm run test:e2e`) |
| `lib/learning-thread.ts` | 대화 사건 수명주기(`beginTurn`·`retryTurn`·`markTurn`·`acceptReply`·`startThread`)와 턴 검증, 복원 시 대기 중 요청의 취소 | 수업 ID·문항 수·답 형식을 모른다. 기록 v3와 수업 기록 v4가 같은 함수를 쓰고 `learning-workspace-state.ts`는 같은 이름으로 다시 내보낸다 | (검사: `npm test`) |
| `lib/lesson-workspace-state.ts` | 이야기·카드 수업 기록 v4: 선택·시도(첫 답·수정)·판정(`check`)·답 보기(`reveal`)·읽기 사건(`reading-start`·`reading-end`)·대화, 수업별 저장 키 | 수업마다 키 하나(`english-sense-lesson-v4:<lessonId>`)라 한 수업의 손상이 다른 수업을 막지 않는다. 장면(have)은 v3와 전역 키를 그대로 쓰고 v4가 읽거나 옮기지 않는다. 판정·AI 응답은 요청 당시 대상과 맞을 때만 채택하고, 다른 판의 기록은 읽기만 한다. 완료·진행률 필드가 없다 | (검사: `npm test`의 `tests/lesson-workspace-state.test.ts`) |
| `lib/learning-catalog.ts`, `lib/server/learning-catalog.ts` | 공개 문항 계약과 정본 일곱 문항 조회·내용 해시 | 브라우저 타입 모듈은 정답 데이터를 import하지 않고 서버가 공개 필드만 넘긴다 | (검사: `npm test`) |
| `lib/lesson-registry.ts`, `lib/lesson-registry-data.ts` | 수업 29개(장면 1·이야기 15·카드 13)의 ID·종류·주소·문항 ID 목록과 공개 투영 타입 | 순수 모듈이라 정답·해설을 담지 않는다. 데이터 파일은 정본에서 만들고(`scripts/generate-lesson-registry.ts`) 단위 검사가 정본과 맞는지 비교한다 | (검사: `npm test`) |
| `lib/server/lesson-catalog.ts`, `lib/server/study-source.ts` | 읽기·사전 훈련 정본 조회·수업별 공개 투영·수업별 자료 판 해시, 이야기 화면의 짝 링크(`getStoryLessonLinks`) | 정본 JSON(`content/reading.json`, `content/prep.json`)은 `lib/server/study-source.ts`만 import한다. 투영은 이야기의 `answer`·`explain`·`basis`와 카드의 `drill.answers`를 뺀다. 목록용 공개 요약(`getStudyListing`)은 이야기를 문제 수로, 사전 훈련을 작품·유닛·카드 수로만 담아 문항과 카드가 들어갈 자리가 없다 | (검사: `npm test`의 `tests/lesson-catalog.test.ts`, `tests/import-direction.test.ts`) |
| `lib/lesson-contract.ts`, `lib/server/lesson-judge.ts`, `lib/server/lesson-check.ts`, `app/api/lesson-check/` | 수업 판정 계약(시도 `choose`·`fill`, 요청·응답, 한도), 서버 정본과의 결정적 비교(`judge`·`revealAnswers`), 무료 판정 경로 | 판정 모듈은 사용량 한도·공급자·Cloudflare 바인딩을 import하지 않고 `fetch`를 부르지 않는다. 카드 빈칸의 틀린 응답에 정답 문자열을 담지 않는다. 장면 수업(have)은 받지 않는다 | (검사: `npm test`의 `tests/lesson-check.test.ts`. 로컬 Workers 실행은 `docs/tasks/workspace-lessons.md` 단계 2) |
| `lib/server/site-pages.ts` | `pages.json`과 읽기·사전 훈련 페이지를 합친 공개 페이지 목록·조회 | `lib/content.ts`(순수)가 정본에 닿지 않도록 합치는 일을 서버 쪽에 둔다 | (리뷰. 단계 1에서 빌드 산출물을 옛 산출물과 비교했다) |
| `app/api/` | Next.js HTTP 진입점 | 서버 환경과 API 처리를 연결한다 | (리뷰) |
| `lib/server/api.ts` | 입력·Origin·한도·Claude 호출·응답 형식 | 잘못된 입력과 준비되지 않은 환경에서 유료 호출을 하지 않는다 | (검사: `npm test`) |
| `lib/learning-chat-contract.ts`, `lib/server/learning-chat.ts` | 다중 대화 계약·서버 정본 맥락 구성·공급자 응답 | 브라우저 대화는 비신뢰 자료로 받고 기존 Origin·사용량 정책을 공유한다 | (검사: `npm test`) |
| `lib/lesson-chat-contract.ts`, `lib/server/lesson-chat-context.ts` | 이야기·카드 수업의 대화 요청·응답 계약(수업·문항은 레지스트리), 수업 종류별 AI 맥락·안내·시스템 문구 | 첫 답은 서버가 `judge`로 다시 판정해 맥락에 넣고 브라우저의 판정 값은 받지 않는다. 장면 수업의 요청·응답 모양은 `learning-chat-contract.ts`가 그대로 받는다 | (검사: `npm test`) |
| `lib/server/cloudflare.ts` | 요청의 서버 환경 조회 | `server-only` 경계로 클라이언트 import를 막는다 | (검사: `npm run cf:build`) |
| `worker.ts`, `lib/server/quota.ts` | OpenNext 처리 연결과 일일 요청 횟수 | SQLite 기반 Durable Object가 전역·IP 한도를 함께 갱신한다 | (검사: `npm test`) |
| `lib/server/legacy-api.ts` | 기존 API 도메인의 경로·CORS 호환 | 지정한 도메인에서만 호환 처리를 한다 | (검사: `npm test`) |

UI는 API를 호출하고 서버는 학습 자료와 외부 공급자를 사용한다. 서버의 비밀값을 UI 상태로 넘기지 않는다.
기존 퀴즈의 진행 상태는 브라우저 메모리에만 있다. 기본 학습 작업 공간은 초안·최초 제출·수정·대화를 같은 브라우저에
임시 보관한다. 개인 기록 DB와 계정 인증은 아직 없다.
같은 Origin을 확인하는 것은 계정 인증이 아니며 개인 기록에 대한 읽기·수정 권한을 보장하지 않는다.

본문 전체는 페이지 스크롤로 읽는다. 넓은 화면에서는 목차·자료 스택·대화를 옆에 유지하고 대화만 내부 스크롤한다. 자료·퀴즈·보기·수행 열람은 본문에 둔다.
첫 답·이유와 수정은 그 퀴즈가 있는 본문 자리에서 입력한다(일곱 문제의 폼이 처음부터 문서에 있다). 첫 답을 내면 AI 피드백을 자동으로 한 번 요청하고, 피드백과 이후의 질문·응답 전문은 그 퀴즈 안에 쌓인다. 대화 칸은 질문 칸과 입력 대상(문서에서 마지막으로 다룬 퀴즈) 표시, 첫 답·수정·질문·응답의 한 줄 요약 타임라인("문서에서 보기"로 본문 위치에 간다)만 둔다. 요청 대기·실패·다시 보내기·중단은 대화 칸에서 다룬다.
퀴즈를 고르는 일(`selectQuestion`)은 사건이 아니다. 본문에서 입력을 시작하면 그 퀴즈가 입력 대상이 되고, 처음 손댈 때 v3의 artifact와 `card` 사건을 만든다. `card` 사건은 기록에 남지만 대화 칸에 줄을 만들지 않는다.
대상별 초안과 수정 열림은 기존 학습 v3가 보관한다. 첫 답·수정·질문의 의미는 합치지 않는다(첫 답은 한 번만, 수정은 따로 쌓이고, 질문은 대화로 간다).
본문에 응답이 들어가면 읽는 위치 위쪽의 퀴즈에 내용이 늘 수 있다. `components/use-reading-hold.ts`가 뷰포트 맨 위 구역의 위치를 기억해 대화 요청·응답 변화 때 그 구역을 제자리로 되돌린다(스크롤 앵커가 없는 브라우저 대비).
projectDocumentArtifacts는 catalog 일곱 문항의 읽기용 상태를 정규 순서로 투영한다. 기존 문항은 당시 snapshot을 복사하고 없는 문항은 저장하지 않는 빈 snapshot으로 보인다.
명시적 selectQuestion만 누락된 학습 artifact와 card 사건을 만든다. 전체 문서 표시는 학습 v3를 변경하지 않으며 기존 사건 포괄 검증도 그대로 유지한다.
콘텐츠는 전체 문서 노드의 자료·문항(첫 답·수정 폼과 수행, AI 피드백·질답 전문)을 표시하고, 대화는 학습 사건을 실제 순서로 한 줄씩 표시한다(전문은 중복해 그리지 않는다). 카드 사건은 입력 대상이 처음 정해진 표식이며 줄을 만들지 않는다.
같은 퀴즈 입력 폼을 두 번 만들거나 원본 사건 배열을 다시 정렬하지 않는다. 새 응답·전송은 콘텐츠 읽기 위치를 바꾸지 않는다.
문항 번호·본문·목차의 문항 순서는 catalog의 questionId 순서다. 실제 선택 순서는 events에만 반영된다.
자료 추가 위치는 당시 사건 ID까지의 마지막 card 위치로 해석한다. 늦은 reply의 대상과 삽입 위치를 혼동하지 않으며 모르는 위치는 끝에 보관한다. 자료 스택은 최근 추가 순서다.
자료 UI v1·학습 v3와 별도로 레이아웃 설정을 저장한다. 콘텐츠는 본문 앵커, 대화는 읽기 위치·끝 따라가기로 복원한다.
좁은 화면은 콘텐츠 다음에 대화를 자연스럽게 이어 놓는다. 명시적 이동은 페이지를 움직일 수 있지만 새 응답은 콘텐츠 읽기를 끊지 않는다.
v3는 문항별 카드·스레드·초안과 전체 사건 순서를 나눠 저장한다.
수업 기록 v4(이야기·카드)는 수업마다 따로 저장한다. 문항을 고르는 것은 사건이 아니고, 첫 답과 수정은 `attempts`에 차례로 쌓여 수정이 첫 답을 덮지 않는다. 판정과 답 보기는 요청 때 대상과 맞을 때만 기록에 붙으며, 읽기 끝은 벽시계 마감으로 읽기마다 한 번만 쓴다. 복원은 요청을 보내지 않는다.
선택한 질문 대상은 읽는 자료·목차 위치와 별개이며 화면 이동이나 자료 열람만으로 바뀌지 않는다.
v1/v2 키는 읽기만 하고 원문을 보존한다. 기존 배포의 고정 자료 해시와 현재 자료가 맞는 경우에만 첫 문항으로 이관한다.
v1에는 수정과 대화 사이의 순서가 없어 **이전 기록** 묶음으로 표시하며 작성 시각·순서를 만들어 넣지 않는다.
읽을 수 없는 기록을 현재 빈 상태로 자동 덮어쓰지 않는다. 새 대화는 현재 퀴즈의 이전 스레드·이벤트·메시지 초안을 남기고
처음 답과 수정은 이어 간다. 다른 퀴즈의 스레드와 초안을 초기화하지 않는다.

## 해설 요청의 현재 처리 순서

1. 브라우저가 같은 도메인의 `/api/explain/` 또는 `/api/translate/`에 JSON을 보낸다.
2. 서버가 Origin, 본문 형식·크기, 빈 입력과 300자 제한을 확인한다.
3. 키와 quota 바인딩의 준비 상태를 확인한다. 실패하면 요청 횟수와 외부 공급자를 사용하지 않는다.
4. UTC 날짜와 그 날짜의 IP 해시로 같은 날짜의 Durable Object에 요청한다. 전역·IP 횟수를 한 트랜잭션에서 확인하고 올린다.
5. 감각 사전·규칙·응답 스키마를 사용해 Claude에 요청한다. 60초 안에 끝나지 않으면 중단한다.
6. 응답 크기·종료 상태·JSON과 필드를 확인한다. 오류는 비밀값이나 공급자 원문을 노출하지 않는 응답으로 바꾼다.
7. 브라우저가 기다림·결과·오류를 표시하고 다음 요청을 허용한다.

한도는 성공한 해설의 수가 아니라 요청을 시도한 수다. 공급자가 실패해도 사용한 횟수를 되돌리지 않는다.
IP는 날짜별 해시만 저장하며 한도 상태는 약 48시간 뒤 지운다. 입력 문장 자체를 이 저장소에 남기지 않는다.
이 구조가 개인 학습 기록·이어 하기·질답 저장까지 제공하는 것은 아니다.

## 학습 대화의 현재 처리 순서

1. 기본 화면은 have 책 장면 일곱 문항의 ID·유형·장면·발문·선택지 문장·출처·자료 판만 전달받는다. 정답 분류·모범 답·해설은 props에 넣지 않는다.
2. 아티팩트·문항·자료 판·요청 ID와 해당 카드의 제출·수정·현재 스레드 질답을 `/api/learn-chat/`로 전송한다. 다른 카드의 대화나 미전송 초안은 자동으로 보내지 않는다.
3. 서버가 Origin·본문 크기·수업·문항·허용 필드·입력 길이를 확인한다. 정본의 자료 판과 답 유형도 대조한다. 불일치는 사용량 차감·공급자 호출 전에 거절한다. 계약은 `lib/learning-chat-contract.ts`가 소유한다.
4. 처음 제출이 없으면 정답을 포함하지 않은 준비 안내를 반환한다. 공급자와 사용량 처리를 호출하지 않으며 AI 응답이라고 표시하지 않는다.
5. 처음 제출 자료가 있으면 키·한도 바인딩을 확인한다. 현재 문항의 서버 정본 장면·해설 또는 쓰기 모범 답·감각 사전만 AI 맥락으로 구성한다.
6. 기존 일일 한도에서 한 번을 사용한 뒤 Claude에 요청한다. 이전 user/assistant 메시지는 단일 사용자 요청의 비신뢰 학습 자료로 직렬화한다.
7. 60초 제한·공급자 응답 크기·종료 상태·텍스트 응답 한도를 확인하고 일반 텍스트 답을 반환한다. 키와 내부 오류는 응답에 넣지 않는다.
8. 브라우저가 응답의 아티팩트·문항·자료 판·요청 ID를 요청 당시 대상과 대조해 그 스레드에 붙인다. 현재 선택이 바뀌어도 응답 대상을 바꾸지 않는다. 취소·새 대화 뒤의 늦은 응답은 적용하지 않는다.

이야기·카드 수업(`lib/lesson-chat-contract.ts`)도 같은 순서를 따른다. 다른 점은 다음과 같다.

- 수업·문항은 레지스트리에서 풀고, 첫 답은 판정 계약의 시도와 같은 정의다. 이야기는 `{ kind: "choose", choice }`(보기 0~3, 이유 없음, 수정 없음), 카드는 `{ kind: "fill", inputs }`(빈칸 1~3개)다. 키는 정확히 맞아야 하므로 브라우저가 판정 값을 실어 보내면 거절한다.
- 처리 순서는 계약 형식 → 자료 판 대조(409) → 첫 답이 없으면 종류별 준비 안내 → 서버가 `judge`로 재판정(종류·보기 수·빈칸 수가 맞지 않으면 400) → 키·한도 바인딩 → 사용량 → 공급자다. 거절은 모두 사용량 앞이다.
- AI 맥락은 수업 종류별 서버 정본이다. 이야기는 본문 전체와 이 문항 하나, 서버 판정, 정본 해설이고, 카드는 이 카드의 표현·뜻·감각·예문·근거, 빈칸 문제, 서버 판정, 빈칸 정본 답이다. 정답·해설·빈칸 답은 첫 답이 있어 AI가 불리는 요청에만 닿고, 첫 답 전에는 안내만 간다. 시스템 안내가 서버 판정을 최종으로 두며 AI가 다른 말을 해도 판정은 바뀌지 않는다.
- "AI에게 설명 요청" 단추의 문장은 종류별이다. 이야기는 처음 고른 보기·서버 판정·정본 해설을 바탕으로 왜 그 보기가 정본 답이고 다른 보기는 왜 아닌지, 본문의 어느 부분을 보면 되는지 묻는다(`lib/story-lesson.ts`). 카드는 처음 채운 빈칸을 표현과 예문에 비추어 묻는다(`lib/card-lesson.ts`). 둘 다 맥락에 이미 있는 것(본문·문항·`correctOption`·`serverJudgement`, 또는 카드·`referenceAnswers`)만 근거로 하고 서버 판정을 바꾸게 하지 않는다. 요청의 짝은 `isLessonChatRequest`가 받고, 응답은 `readLessonChatResponse`가 요청 당시 대상과 같을 때만 읽는다.
- 응답은 `lessonId`를 더해 되돌린다(`LessonChatResponse`). 장면 수업의 응답에는 `lessonId`를 더하지 않는다. 브라우저의 `isArtifactLearningChatResponse`가 정확한 키를 검사하기 때문이다.
- 사용량은 장면 수업과 같은 일일 전역·IP 한도를 쓴다. 판정 경로(`/api/lesson-check/`)는 이를 쓰지 않는다.

기존 첫 문항의 요청·응답 형식은 별도 호환 경로로 받는다. 그 경로도 기존 자료 해시가 달라지면 409로 거절한다.
대화 API는 서버에 대화를 영속 저장하지 않는다. 클라이언트의 최초 답은 인증된 학습 이력이 아니며 역할·내용의 진실성을
보장하지 않는다. 제한된 학습 자료로 검증·구성하는 것이지 prompt injection이나 AI 해설 오류를 완전히 차단하는 것은 아니다.
요청 ID는 응답 채택 식별용이다. 서버 멱등 처리나 재시도 비용 중복 방지를 보장하지 않는다.
중단·타임아웃 뒤 명시적으로 다시 보내면 사용량이 추가로 발생할 수 있으며 pending 복원만으로 자동 재호출하지 않는다.
일반 영어 감각 자료는 제출 전에도 읽을 수 있지만, 이번 버전의 제출 전 대화는 준비 안내에 한정된다.
현재 AI는 서버의 장면 본문과 수행·대화 텍스트를 받는다. 감각 이미지의 픽셀이나 사용자가 보는 화면을 모델에 전송하는 시각 질답 기능은 없다.

## 수업 판정의 현재 처리 순서

읽기 이야기와 사전 훈련 카드의 판정은 `/api/lesson-check/`가 맡는다. 계약은 `lib/lesson-contract.ts`가 소유한다.

1. 메서드(POST)와 Origin을 확인한다. 이 경로는 Cloudflare 바인딩을 읽지 않는다.
2. 본문 형식(JSON)과 크기(4KB)를 확인하고, 정확한 키·ID 형식·시도 형식(`choose`는 보기 번호 0~3, `fill`은 빈칸 1~3개·빈칸당 100자)을 검사한다. `reveal`은 첫 답으로 쓸 입력이 함께 온 카드 요청만 받는다.
3. 수업과 문항이 레지스트리에 있는지 본다. 장면 수업(`titanic-have`)은 `unsupported_lesson`으로 거절하고 기존 대화 경로에 둔다.
4. 요청의 자료 판을 서버의 수업별 판과 대조한다. 다르면 409 `content_changed`이고 판정하지 않는다.
5. 시도가 문항과 맞는지(종류, 실제 보기 수, 실제 빈칸 수) 확인한 뒤 `judge`가 정본과 비교한다. 이야기는 이 응답에서 처음으로 정답 보기와 `explain`·`basis`를 낸다. 카드는 빈칸별 같음/다름만 내고, 정답 문자열은 `reveal` 응답에만 있다. 빈칸 비교는 `lib/fill-blank.ts`의 정규화를 쓴다.
6. 응답에 `requestId`·`lessonId`·`artifactId`·`questionId`·`contentVersion`을 되돌린다. 판정은 멱등이고 저장하지 않는다.

AI와 사용량 한도를 쓰지 않으므로 한도가 찬 날에도 판정은 응답한다. "정답입니다"가 아니라 "정본 답과 같습니다/다릅니다"를 뜻하는 필드(`match`, `matches`, `allMatch`)를 낸다.
`reveal`이 첫 답 입력을 요구하는 것은 공개 시점 규칙을 서버가 지키는 최소한이고, 그 입력이 실제 첫 답이었는지는 서버가 알 수 없다. 이 경로를 아는 사람이 답을 여러 번 대 보는 것은 막지 않는다.

## 수업 화면의 현재 처리 순서

이야기(`/reading/<id>/`)와 카드(`/prep/<작품>/unit-<n>/`) 수업이 같은 순서로 움직인다. 같은 기능은 `components/lesson-common.tsx` 한 곳에 있다.

1. 서버가 수업의 공개 투영과 짝 링크·이웃 유닛만 props로 넘긴다. 정답·해설·근거·`drill.answers`는 브라우저로 가지 않는다.
2. 브라우저가 수업 키 하나(`english-sense-lesson-v4:<lessonId>`)에서 기록을 읽는다. 읽지 못하면 원본을 보존하고 그 수업만 막는다. 복원은 요청을 만들지 않는다.
3. 이야기는 읽기를 시작해 벽시계로 마감하고(끝 사건은 읽기마다 한 번), 끝난 뒤 문제가 열린다. 카드는 처음부터 열려 있다. 문제·카드를 고르는 것은 사건이 아니다.
4. 첫 답은 기록에 시도로 먼저 쌓인 뒤 `/api/lesson-check/`로 간다(20초 제한). 응답이 요청 당시의 수업·문항·카드·판과 맞을 때만 그 시도의 판정으로 붙는다. 실패하면 첫 답을 두고 "판정을 받지 못했습니다. 답은 남아 있습니다."와 "다시 판정"을 보인다. 같은 요청을 다시 보내도 결과가 같다.
5. 카드의 수정은 직전 판정을 받은 뒤의 새 시도이고(6회), '답 보기'는 첫 답 뒤에만 열려 `reveal` 사건으로 남는다.
6. AI는 사용자가 "AI에게 설명 요청"이나 질문을 보낼 때만 `/api/learn-chat/`을 부른다. 판정·문서·기록은 한도와 AI 실패에 상관없이 계속 동작한다.
7. 기록이 옛 자료 판이면 읽기 전용이다. 판정·AI 전송이 막히고, 확인 한 번을 거친 "이 기록을 지우고 새 판으로 시작"이 그 수업의 기록 하나만 새 기록으로 바꾼다.
8. 수업 사이 이동은 페이지 이동이다. 홈의 "수업 목록" 창과 이야기·카드 도구 막대의 "수업 목록" 링크가 기존 주소로 간다.
펜 노트는 이 순서와 따로 움직이는 별도 저장이다(홈 have도 같다).

1. 화면이 글 요소를 `NoteBlock`(안정적인 블록 키 `data-note-block`)으로 그린다. 첫 HTML과 첫 클라이언트 렌더는 노트 없는 글이다.
2. 하이드레이션 뒤 노트 키 하나(`english-sense-notes-v1:<lessonId>`)를 읽는다. 읽지 못하면 그 수업의 노트만 비우고 안내한다(손상 파일은 다음 노트를 저장할 때까지 그대로 둔다). 읽기는 요청도 사건도 만들지 않는다.
3. 노트는 블록 키와 선택한 글(정확한 문구와 앞뒤 12자)로 글에 붙는다. 글이 달라져 찾지 못하면 지우지 않고 "이 글을 찾지 못한 노트"로 목록에 남긴다.
4. 노트를 만들거나 고치거나 지울 때만 그 키에 쓴다. 쓰지 못하면 노트는 화면에 남고 상태 표시줄, 문서 위 안내, 도구, 메모 칸에 저장 경고와 "저장 다시 시도"가 나온다. 수업 기록의 저장 상태와는 따로다.
5. 이야기 본문을 가린 동안에는 본문 노트의 글을 어디에도 그리지 않고 표시 종류와 메모만 보인다.


## 실행·배포의 현재 선택

Next.js 16.4.3·React 19.3.1과 OpenNext 1.20.13을 사용하며 Cloudflare Workers에서 실행한다.
공통 콘텐츠는 정적 생성하고 해설 API는 요청 때 실행한다. `cacheComponents`는 명시적으로 켜지 않았다.
Cloudflare 비밀값은 Worker secret, 일반 변수·바인딩과 호환 설정은 `wrangler.jsonc`가 소유한다.
자산의 Worker 우선 처리 값은 OpenNext 산출물에도 들어가므로 설정을 바꾸면 다시 빌드한다.

2026-10-26 확인한 Cloudflare 안내는 신규 Next.js 앱에 vinext를 기본 경로로 권한다.
이 전환에서는 실제 Next.js 빌드를 사용하는 OpenNext 조합을 구성·검증했다. 두 경로의 지원 범위는 이후 기능 선택 때 다시 확인한다.
특정 어댑터를 모든 앱의 정답으로 모델에 고정하지 않는다.

## 확인한 범위와 남은 상태

- 전환본: https://english-sense.jaeyoung2010.workers.dev
- 기존 12개 URL과 PC·휴대폰 조작, 퀴즈 끝내기·재시작·해설기 오류 복구를 Workers 환경에서 확인했다.
- 준비 상태뿐 아니라 실제 영어 해설과 한국어 변환의 200 응답을 브라우저 경로에서 확인했다.
- 공개 운영 주소와 기존 API 도메인을 같은 Worker의 Custom Domain으로 전환했다. GitHub Pages 게시를 해제했다. 이전 원격 API 프로세스는 복구용으로 남겨 두었다.
- 콘텐츠·대화 분리의 현재 수용 근거는 `docs/tasks/content-chat-workspace.md`, 이전 문서·스택 근거는 `docs/tasks/document-workspace.md`에 있다.
- 이야기 15편·유닛 13개 수업(서버 정본·무료 판정·수업별 기록·읽기 구역·카드 수업)의 수용 근거와 미확인 범위는 `docs/tasks/workspace-lessons.md`에 있다.
- 퀴즈 아티팩트·대화 API·모델 예측의 수용 근거는 `docs/tasks/quiz-artifacts.md`에 있다. 이전 단일 문제 근거는 `docs/tasks/learning-workspace.md`에 있다. 개인 서버 기록·인증·권한·다른 기기 복원·이전 기록 연결은 남아 있다.

테스트가 확인하는 조건과 미확인 범위는 `docs/cloudflare-migration.md`와 작업 계약의 수용 근거에 연결한다.
