# Lighthouse 구현 기법의 출처와 차용 범위

2026-10-26 강PD가 Lighthouse의 기획·구현 기법을 모델과 스킬로 차용하도록 지시했다. 이 문서는 구현 스킬의
출처를 연결한다. 원본은 읽기만 했고, 원본 테스트를 실행하지 않았다. 구현 순서를 도입한 효과는 아직 확인하지 않았다.

대상은 `~/lighthouse`, 원격 저장소는 `jaeyoungkang/lighthouse`, 기준 커밋은
`df85ac9a6f09c569d0e01b83ebdca4eebc996ea5`다. 조사 전후 작업 트리는 깨끗했다.

## 원문에서 현재 스킬로 옮긴 것

| 원문과 확인한 내용 | 구현 스킬에서 고른 순서 |
| --- | --- |
| [구현 가이드](https://github.com/jaeyoungkang/lighthouse/blob/df85ac9a6f09c569d0e01b83ebdca4eebc996ea5/docs/implementation.md)의 "Runtime zone", "Cross-cutting obligation", "구현 순서"는 실행 위치와 영향 의무를 구분하고 가장 작은 공통 담당 위치에서 구현한다. | 1에서 현재 경로와 영향 범위를 가르고 3에서 담당 위치를 정한다. 전체 owner·승인 체계는 가져오지 않았다. |
| [코딩 규칙](https://github.com/jaeyoungkang/lighthouse/blob/df85ac9a6f09c569d0e01b83ebdca4eebc996ea5/docs/conventions.md)의 "구현 착수 — 실행 가능한 최소 절단"은 실패하면 방향이 달라질 가정이 있을 때만 실제 production 경계로 최소 실행을 고른다. | 2에서 기존 검증으로 충분한 경우를 먼저 가르고, 미확인 가정이 남으면 대표 입력 하나로 확인한다. 별도 CLI 제작을 기본 절차로 삼지 않았다. |
| 같은 문서 "파생 우선과 중립 계약 owner"는 공유 schema·타입의 뜻을 효과가 없는 한 담당 모듈에서 정한다. | 3에서 실제 공유 계약과 변환 경계를 판단한다. 작은 앱에 사용하지 않는 저장 계층을 추가하지 않았다. |
| [Runtime Flow Docs](https://github.com/jaeyoungkang/lighthouse/blob/df85ac9a6f09c569d0e01b83ebdca4eebc996ea5/docs/runtime-flows/README.md)의 "고도화 런타임 기능의 기본 구조", "변경 규칙"은 순서·실패·상태 담당 위치를 현재 구현과 맞춘다. [Runtime Flow Sync Skill](https://github.com/jaeyoungkang/lighthouse/blob/df85ac9a6f09c569d0e01b83ebdca4eebc996ea5/shared-skills/runtime-flow-sync/SKILL.md)의 "Workflow"는 코드부터 읽고 설계·현재 동작·관찰을 나눈다. | 4에서 실패를 검증 대상으로 고르고 6에서 현재 구조 문서와 실행 결과를 맞춘다. 별도 runtime-flow 문서 체계를 만들지는 않았다. |

## 문서와 실제 코드·테스트의 연결

표본은 [검색 보강 흐름](https://github.com/jaeyoungkang/lighthouse/blob/df85ac9a6f09c569d0e01b83ebdca4eebc996ea5/docs/runtime-flows/search-background-enrichment.md)의
"Spelling Correction"이다. 원문은 query-only command, 입력 제한, provider 호출과 실패 시 동작, 현재 실행에 대한
응답 반영을 설명한다. 다음 소스에서 그 연결을 확인했다.

- [실제 route와 테스트](https://github.com/jaeyoungkang/lighthouse/tree/df85ac9a6f09c569d0e01b83ebdca4eebc996ea5/app/api/search/spelling-correction):
  `route.ts`는 인증·body·schema·admission을 거쳐 service를 부른다. `__tests__/route.test.ts`는 실제 `POST`를
  호출하며 잘못된 JSON, 크기 초과와 한도 초과가 외부 생성까지 도달하지 않는지 확인한다. 초기 최소 실행을 먼저
  했다는 개발 이력이나 테스트의 현재 통과 여부를 확인한 것은 아니다.
- [공용 계약](https://github.com/jaeyoungkang/lighthouse/blob/df85ac9a6f09c569d0e01b83ebdca4eebc996ea5/app/domain/search-background-transport.ts)의
  `searchSpellingCorrectionDeltaResponseV1Schema`를 route와 브라우저 hook이 함께 쓴다. 각자 전체 metadata를
  다시 정의하지 않고 query target과 교정 delta를 검증한다.
- [브라우저 hook](https://github.com/jaeyoungkang/lighthouse/blob/df85ac9a6f09c569d0e01b83ebdca4eebc996ea5/app/components/research-route-renderers/use-search-spelling-correction-request.ts)은
  실행·화면·query로 요청을 구별하고 응답을 적용할 때 현재 실행을 다시 확인한다.
  [관련 테스트](https://github.com/jaeyoungkang/lighthouse/blob/df85ac9a6f09c569d0e01b83ebdca4eebc996ea5/app/components/research-route-renderers/__tests__/search-view-content.spelling-correction.test.tsx)는
  중복 요청, 중단을 무시하는 transport의 timeout, 이전 실행의 늦은 응답을 다룬다.

Lighthouse의 응답 envelope·재시도·AI channel·인증·조용한 실패 정책과 기능 코드는 복사하지 않았다. Project Knowledge
명령, 전체 quality gate, Architecture Fitness 체계와 외부 승인 절차도 도입하지 않았다. 영어 감각의 현재 API 오류와
사용량 정책은 실제 구현과 제품 계약이 소유한다.

## 이 프로젝트에서 더한 확인

실제 배포 런타임 확인은 원문의 최소 실행·검증 범위를 현재 Next.js와 Cloudflare 경계에 맞춘 판단이다.
이번 이관에서는 `run_worker_first`의 과거 값이 산출물에 남아 HTML은 열려도 JavaScript·CSS가 404가 된 일이
있었다. Next 개발 서버가 같은 Worker의 Durable Object를 실행하지 못한 조건도 확인했다.

이를 배경 모델 `knowledge/domain/nextjs-development.md` "규칙" 8·9에 연결해 구현 스킬 5에서 해당 런타임을
확인하도록 맞췄다. Lighthouse의 운영 성공을 이 앱의 성공 근거로 옮기지 않았고, 이번 구현 검증을 강PD의 learn
기록으로 적지 않았다.
