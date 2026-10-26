# 영어 감각

터미널에서 진행하던 영어 학습을 웹에서 편리하게 이어 가도록 만드는 서비스다. 기본동사의 감각을 읽고,
원서 장면의 표현을 고르거나 쓰며, AI 해설로 문장이 그리는 그림을 살핀다.

넓은 화면에서는 감각 자료·퀴즈가 쌓이는 문서 옆에서 AI와 대화한다. 두 칸은 각각 스크롤하며 첫 답·수정·질문 입력은 대화 칸에 모은다.
실제 추가한 자료와 퀴즈에서 목차가 생기고, 콘텐츠 칸의 자료 스택에서는 최근 추가한 감각 자료를 펼친다.
좁은 화면은 탭 없이 문서 다음에 대화를 이어 놓는다. have·get·be·go 설명을 문서에 추가해 읽는다.
기존 have 책 장면 일곱 문항을 고르기·쓰기로 풀고, 카드별 처음 답·수정·질답을 유지한다.
입력창의 질문 대상을 바꾸어 과거 카드와도 대화를 이어 간다. 수행·대화는 같은 브라우저에 임시 보관한다.
개인 서버 저장·인증·다른 기기 동기화는 아직 없다. 제출 전에는 준비된 과업 안내를, 제출 후에는 실제 AI 응답을 제공한다.

운영 주소는 https://english.artificialmind.kr/ 이다. Next.js App Router와 React로 화면을 만들고,
OpenNext 어댑터로 Cloudflare Workers에서 화면과 해설 API를 함께 실행한다. 기존 API 도메인도 같은 Worker에 연결했다.
프로젝트 기반은 project-base에서 받은 씨앗 모델·스킬·상태판·push 훅이다.

## 실행

Node.js 24와 npm을 쓴다. 처음 받은 뒤 의존성을 설치하고 프로젝트 훅을 켠다.

```sh
npm ci
git config core.hooksPath .githooks
cp .dev.vars.example .dev.vars
npm run dev
```

개발 화면은 http://localhost:3000/ 에서 연다. 해설을 실행하려면 `.dev.vars`의 `ANTHROPIC_API_KEY`를 채운다.
키가 없어도 콘텐츠와 문제는 사용할 수 있다. API와 횟수 제한은 `npm run preview`의 Workers 런타임에서 확인한다.
`next dev`는 같은 Worker 안의 Durable Object를 실행하지 못하므로 이 환경에서 해설 API의 성공을 보장하지 않는다. `.dev.vars`는 git으로 추적하지 않는다.
Claude Code는 `.claude/skills/`, Codex는 `.agents/skills` 링크에서 같은 스킬을 읽는다.

## 구조

| 경로 | 하는 일 |
| --- | --- |
| `app/` | App Router 페이지, API 경로, 메타데이터와 전역 스타일 |
| `components/` | 쓰임 그림 전환, 문제 풀이, AI 해설을 처리하는 React 컴포넌트 |
| `components/learning-workspace.tsx`, `app/workspace.css` | 콘텐츠 문서와 대화·목차·자료 스택·임시 복원 |
| `lib/workspace-layout-state.ts` | 목차 접힘과 채팅 읽기 설정의 별도 저장·복원 |
| `lib/document-workspace-state.ts` | 학습 기록과 분리한 자료 추가·펼침·목차 UI 상태 |
| `lib/reference-materials.ts`, `lib/server/reference-materials.ts` | 기존 공개 감각 자료의 안전한 전달 |
| `content/site.json` | 표제어와 책, 사이트 기본 설정 |
| `content/pages.json` | 공개 페이지의 본문, 메타데이터, 문제와 쓰임 그림 데이터 |
| `content/ask.json` | 해설기 예시 문장과 예시 해설 |
| `lib/content.ts` | 콘텐츠 타입과 페이지 조회 |
| `lib/learning-catalog.ts`, `lib/server/learning-catalog.ts` | 공개 문항 타입과 서버 정본 조회·자료 판·안전한 공개 필드 변환 |
| `lib/learning-workspace-state.ts` | 카드별 수행·전체 사건·임시 기록 검사와 이전 버전 이관 |
| `lib/server/` | Claude 요청, 감각 사전, 응답 검증과 일일 요청 제한 |
| `worker.ts` | OpenNext 요청 처리와 Durable Object 내보내기 |
| `public/assets/` | 아이콘·공유 이미지와 표현의 감각 이미지 |
| `wrangler.jsonc`, `open-next.config.ts` | Cloudflare 바인딩과 빌드 설정 |
| `knowledge/`, `.claude/skills/` | project-base 공통 모델과 스킬, 웹 영어 학습 모델 |
| `tests/` | API·요청 제한 검사와 실제 브라우저 검사 |

기존 원리 페이지와 연습 주소를 유지한다. `/have.html` 같은 옛 주소는 해당 페이지로 영구 이동한다.
콘텐츠를 고칠 때는 `content/`와 해당 컴포넌트를 고친다. HTML을 따로 생성해 커밋하지 않는다.
학습 모델, 원본 문제와 학습 기록의 정본은 study-and-learn 프로젝트가 관리한다.

## 해설 API

| 경로 | 요청과 응답 |
| --- | --- |
| `GET /api/health/` | 키와 요청 제한 바인딩의 준비 상태, 사용하는 모델 |
| `POST /api/learn-chat/` | 정본 장면·처음 답·수정·이전 질답을 이용한 학습 대화. 계약은 `lib/learning-chat-contract.ts` |
| `POST /api/explain/` | 영어 문장을 감각으로 해설한다 |
| `POST /api/translate/` | 한국어를 영어로 옮기고 감각으로 해설한다 |

단문 해설·변환 POST 본문은 `{"text":"I don't get it."}` 같은 JSON이고, 빈 문장을 제외한 300자까지 받는다.
학습 대화는 문항·자료 판·아티팩트·최초 답·수정·이전 질답을 보내는 별도 계약이며 같은 300자 제한을 쓰지 않는다.
브라우저는 같은 도메인의 API를 부른다. 키와 감각 사전 지시문은 서버에서만 쓴다.
기존 감각 사전과 해설 형식, 기본 모델 Claude Sonnet 5.5를 옮겼다.

UTC 날짜를 기준으로 한 IP에서 하루 30번, 전체에서 600번까지 요청할 수 있다.
SQLite 기반 Durable Object가 두 한도를 함께 검사하므로 실행 인스턴스나 배포가 달라져도 같은 날짜의 사용량을 공유한다.
입력 문장과 원래 IP는 저장하지 않는다. 한도 검사에 쓰는 날짜별 IP 해시와 횟수는 짧게 보관한 뒤 지운다.

## 검사와 배포

Next.js 타입과 API 검사, 실제 Workers 빌드와 브라우저 검사를 실행한다.

```sh
npm run check
python3 -m unittest discover -s scripts -p 'test_*.py'
npm run cf:build
npm run test:e2e
```

브라우저 검사는 Chromium이 필요하다. 처음에는 `npx playwright install chromium`으로 설치한다.
`npm run preview`는 빌드한 서비스를 로컬 Workers 런타임에서 실행한다.
GitHub Actions도 같은 검사와 Workers 빌드를 실행한다.

Cloudflare 계정 인증과 Worker secret을 준비한 뒤 배포한다. 비밀값은 명령 인수나 문서에 적지 않고 입력한다.

```sh
npx wrangler login
npx wrangler secret put ANTHROPIC_API_KEY
npm run deploy
```

일반 설정은 `wrangler.jsonc`의 `vars`에 있다. 설정을 바꾸면 `npm run cf:typegen`을 실행하고 다시 배포한다.
한도나 모델을 바꾸면 운영 안내와 화면의 설명도 함께 맞춘다.
도메인 전환과 검증 결과는 [Cloudflare 전환 문서](docs/cloudflare-migration.md)에 있다.
새 기능의 범위는 [개인 학습 요구사항](docs/learning-service.md)과 [상태판](https://github.com/jaeyoungkang/english-sense/issues/2)에서 확인한다.

## 제작 모델과 스킬

- [웹앱 제작 모델](knowledge/domain/web-app-production.md): 사용자 과업과 약속, 품질과 검증 근거를 연결한다.
- [웹앱 UX 설계 모델](knowledge/domain/web-app-ux-design.md): 정보구조·맥락·상태·시각 위계·복구와 재개를 설명한다.
- [웹앱 아키텍처 모델](knowledge/domain/web-app-architecture.md): 책임·상태·데이터·신뢰·실행 경계를 설명한다.
- [Next.js 개발 모델](knowledge/domain/nextjs-development.md): App Router·컴포넌트·렌더링·변경·캐시의 실행 의미를 설명한다.
- [기획 스킬](.claude/skills/web-app-planning/SKILL.md): 승인된 요구를 수용 조건·구조 영향·최소 구현 범위가 있는 작업 계약으로 만든다.
- [구현 스킬](.claude/skills/web-app-implementation/SKILL.md): 미검증 가정을 실제 경계에서 확인하고 구현·실패·배포 결과를 연결한다.

[Lighthouse 조사](docs/research/lighthouse-methods.md)에는 원문 커밋과 실제 코드·테스트, 이 서비스에 옮긴 판단을 나눴다.
계약부터 엔지니어링까지의 실제 추적은 [상세 조사](docs/research/lighthouse-contract-engineering.md)에 있다.
규칙은 모델이, 수행 순서는 스킬이 소유한다. 현재 선택한 구조는 [아키텍처 문서](docs/architecture.md)에 있다.

현재 [디자인](docs/ux-design.md)은 실제 Next.js 기본 학습 화면과 AI 대화로 연결했다. 확인한 경로와 남은 한계는
[콘텐츠·대화 작업 계약과 모델 평가](docs/tasks/content-chat-workspace.md)에 있다. 기존 퀴즈 수행의 근거는
[퀴즈 아티팩트 계약](docs/tasks/quiz-artifacts.md)에 있다. [이전 시안](design/prototype/index.html)은 소개 중심 첫 제안으로 남겨 둔다.

개인 서버 기록과 다른 기기 이어 하기는 아직 없다. 현재 수행·대화와 문서 탐색 상태는 같은 브라우저에만 임시 보관한다.
