# 웹앱 구현 — 이 프로젝트에 맞춘 것

## 현재 정본과 실행 경로

| 판단할 것 | 읽을 곳 |
| --- | --- |
| 승인한 제품 동작과 아직 만들지 않은 범위 | `docs/learning-service.md`, 현재 작업 이슈 |
| 현재 요청 순서, 상태·규칙의 담당 위치와 의존 경계 | `docs/architecture.md` |
| UX 판단과 현재 학습 작업 공간의 경계 | `knowledge/domain/web-app-ux-design.md`, `docs/ux-design.md`, `docs/tasks/quiz-artifacts.md`와 이전 `docs/tasks/learning-workspace.md` |
| 실행 환경과 운영 전환 | `README.md`, `docs/cloudflare-migration.md` |
| 실제 명령과 배포 설정 | `package.json`, `playwright.config.ts`, `next.config.ts`, `wrangler.jsonc`, `open-next.config.ts` |

공개 페이지는 `app/`과 `content/`, 브라우저 조작은 `components/`에서 시작한다. 해설 요청은
`app/api/explain/route.ts`·`app/api/translate/route.ts`에서 `lib/server/api.ts`로 이어진다.
Cloudflare 바인딩은 `lib/server/cloudflare.ts`, 사용량 변경은 `lib/server/quota.ts`, 옛 API 도메인의 호환은
`worker.ts`와 `lib/server/legacy-api.ts`가 맡는다. 경로와 실제 흐름이 달라지면 구조 문서를 현재 코드에 맞춘다.

현재 영속 상태는 일일 요청 횟수다. 개인 학습 기록 저장과 인증·인가는 아직 구현하지 않았다. 그 기능을 만들 때는
먼저 기획에서 범위를 정하고 구조 모델로 담당 위치를 판단한다.

Lighthouse의 계약부터 코드·검사까지 추적한 출처와 결과 불명·실행 식별성·복원 범위 사례는
`docs/research/lighthouse-contract-engineering.md`에 있다. module-level request map, 선호의 최신값 압축,
원본 재시도 횟수나 저장 제품은 우리 학습 수행에 그대로 적용하지 않는다.

## 실행면과 확인 범위

명령의 정의는 `package.json`이 소유한다. 아래 표는 2026-10-26 확인한 명령의 용도다.

| 실행 | 확인하는 것과 전제 |
| --- | --- |
| `npm run dev` | Next 개발 화면과 콘텐츠. 같은 Worker의 Durable Object를 실행하지 못한 조건이 있어 해설 API 성공의 근거로 쓰지 않는다. |
| `npm run check` | TypeScript 검사와 `tests/*.test.ts` 단위 검사. 브라우저·Workers 빌드 검사는 포함하지 않는다. |
| `npm run cf:build` | 현재 설정을 반영한 OpenNext 산출물 생성. 설정을 바꾼 뒤 과거 산출물을 재사용하지 않는다. |
| `npm run preview` | 새로 빌드한 산출물을 로컬 Workers 런타임에서 실행한다. API·Durable Object·정적 자산을 이 환경에서 확인한다. |
| `npm run test:e2e` | 현재 빌드 산출물에 Playwright 검사를 실행한다. 기본 설정은 Wrangler 서버를 띄우거나 실행 중인 로컬 서버를 재사용한다. 먼저 Workers 빌드를 마친다. |

`TEST_BASE_URL`을 지정한 브라우저 검사는 그 주소를 사용하며 로컬 서버를 띄우지 않는다. 로컬 preview의 성공과
실제 운영 도메인의 성공은 구분해 남긴다. `.githooks/pre-push`의 `CHECK`는 현재 비어 있으므로 이 명령들이
push를 막는 검사로 설정됐다고 쓰지 않는다.

해설·번역 경계의 기존 검사는 `tests/api.test.ts`, 사용량의 원자성과 지속성은 `tests/quota.test.ts`,
옛 도메인 호환은 `tests/api-legacy.test.ts`에 있다. 단위 검사의 공급자 응답 주입은 실제 유료 호출과 구별한다.
화면 조작의 기존 경로는 `tests/e2e/migration.spec.ts`에서 찾는다.

비용 경계의 검토 사례로는 잘못된 입력·키 부재에서 공급자와 사용량 처리에 도달하지 않는지, 동시 요청이 두 한도를
함께 지키는지, 공급자 실패에서 설명 가능한 오류를 돌려주는지를 사용한다. 비밀 값이나 원문 입력을 검증 기록에 남기지 않는다.

## 스킬 검토 사례

아래는 새 스킬을 현재 코드와 문서에 대조한 읽기 검토다. 스킬 유무를 나눈 실제 구현 실험은 아직 하지 않았다.

| 사례 | 이 순서에서 결정할 것 | 기존 근거와 남은 범위 |
| --- | --- | --- |
| Worker 설정 변경 뒤 HTML은 열리지만 버튼이 동작하지 않는다 | 2에서 실제 자산 경계를 가정으로 고르고, 5에서 새 산출물의 JS·CSS 전달과 버튼 결과를 함께 본다. | 기존 이관에서 과거 `run_worker_first` 값이 산출물에 남아 자산이 404가 된 사례가 있다. 스킬을 써서 재발을 막았다는 결과는 없다. |
| 해설 입력 제한을 국소 수정한다 | 2에서 기존 API 실행 경로와 경계 테스트가 가정을 덮는지 보고, 4에서 해당 거절이 비용과 사용량 변경을 막는지 확인한다. | 기존 API 테스트를 재사용할 수 있다. 수정할 규칙과 결과가 아직 없으면 새 harness를 만들 이유도 없다. |
| 개인 학습 기록 저장을 다음 기능으로 요청한다 | 1에서 승인한 저장·공유·복구 기대를 읽고 담당 위치를 정한다. 계약이 없으면 기획으로 연결한다. | 현재 코드에 개인 기록 저장·인증이 없으므로, 기존 사용량 객체가 이 기능도 해결했다고 판단하지 않는다. |

이 세 사례를 스킬 없이 처리했을 때와 비교해 구현 판단과 검증 범위가 달라지는지 이후 작업에서 확인한다.
아직 이 스킬의 효과를 확인한 것으로 기록하지 않는다.
