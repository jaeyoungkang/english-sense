# Lighthouse에서 차용한 기획 절차

2026-10-26 강PD는 Lighthouse의 기획·구현 기법을 개인 영어 학습 앱에 맞춰 모델과 스킬로 옮기도록 지시했다.
이 문서는 기획 스킬의 출처와 바꾼 범위를 기록한다. 원문은 `/Users/jaeyoungkang/lighthouse`에서 읽었고,
원격 저장소는 `git remote get-url origin`으로 `https://github.com/jaeyoungkang/lighthouse.git`임을 확인했다.
기준 커밋은 `df85ac9a6f09c569d0e01b83ebdca4eebc996ea5`다. 스킬을 그대로 골라 온 사본이 아니므로
`metadata.picked_from`을 붙이지 않는다.

## 원문의 절차와 이식한 자리

아래 링크는 모두 같은 기준 커밋을 가리킨다. 대상 모델은 개념과 판단 기준을, 이 스킬은 선택한 순서를 소유한다.

| 원문 경로·절 | 확인한 기법 | 이식한 자리 |
| --- | --- | --- |
| [shared-skills/mission-control/SKILL.md](https://github.com/jaeyoungkang/lighthouse/blob/df85ac9a6f09c569d0e01b83ebdca4eebc996ea5/shared-skills/mission-control/SKILL.md) "Workflow" 2·7 | 승인된 의미를 읽고 계약·구현·증거를 잇는 순서 | 스킬 1·2·6. 현재 승인에서 출발하고 작업 계약 하나를 구현에 넘긴다 |
| [docs/intent-traceability.md](https://github.com/jaeyoungkang/lighthouse/blob/df85ac9a6f09c569d0e01b83ebdca4eebc996ea5/docs/intent-traceability.md) "Three Layers", "Evidence Rules" | 자동 확인과 질적 질문을 구별하고 실제 출력으로 확인한다 | 스킬 3·6, 계약 틀의 수용 증거 표와 사람 판단 질문 |
| [docs/mission-control.md](https://github.com/jaeyoungkang/lighthouse/blob/df85ac9a6f09c569d0e01b83ebdca4eebc996ea5/docs/mission-control.md) "Chain Closure" 5 | 최종 화면이 의존하는 실제 생성·저장·분기까지 증거로 연결한다 | 스킬 3, 계약 틀의 입력·생성·상태 경로 칸 |
| [shared-skills/mission-control/references/contract-architecture-impact-review.md](https://github.com/jaeyoungkang/lighthouse/blob/df85ac9a6f09c569d0e01b83ebdca4eebc996ea5/shared-skills/mission-control/references/contract-architecture-impact-review.md) "Triggers", "Decision Record" | 기대가 구조에 영향을 줄 때 구현 전에 책임·대안·검증을 정한다 | 스킬 4. 대상 프로젝트의 구조 영향 표기와 모델에 맞춰 줄였다 |
| [shared-skills/mission-control/references/product-architecture-content-ownership.md](https://github.com/jaeyoungkang/lighthouse/blob/df85ac9a6f09c569d0e01b83ebdca4eebc996ea5/shared-skills/mission-control/references/product-architecture-content-ownership.md) "Canonical Owners", "Clause Classification" | 제품 의미, 내부 구조와 정확한 검증 근거의 위치를 나눈다 | 스킬 2·3·4와 계약 틀의 절 구분 |
| [shared-skills/mission-control/references/propagation-scope-control.md](https://github.com/jaeyoungkang/lighthouse/blob/df85ac9a6f09c569d0e01b83ebdca4eebc996ea5/shared-skills/mission-control/references/propagation-scope-control.md) "Minimum Owner Closure", "Propagation Map" | 직접 필요한 변경과 살펴볼 후속 영향을 나눈다 | 스킬 5와 계약 틀의 변경 범위. 원문의 고정 파일·줄 수 기준은 가져오지 않았다 |

## 문서 규칙과 실제 사용을 구별한 근거

- `docs/contracts/story-chain/promises/search-query-route-transition.md`의 수용 조건은
  `docs/contracts/story-chain/evidence-ledgers/search-query-route-transition.ledger.yaml`에서 실제 테스트 파일로 이어진다.
  `app/components/research/__tests__/ResearchRouteSearchBar.test.tsx`는 즉시 주소 변경, 회전 표시,
  `aria-busy`와 중복 제출 방지를 DOM에서 검사한다. `ResearchRouteRuntime.route-owned-render.test.tsx`는
  이전 화면 데이터를 먼저 넣고 새 화면의 첫 렌더에 섞이지 않는지, 떠날 때 상태를 정리하는지 검사한다.
- `app/server/services/__tests__/search-awareness-intent-qualitative.live.test.ts`는 준비한 검색 입력을 실제
  `generateRouteAiComment()`에 넘기고 그 결과를 판정한다. 테스트 입력은 실제 사용자 조사 기록이 아니며,
  검사하는 생성 결과도 수작업 모범 답이 아니다.
- `docs/contracts/story-chain/evidence-ledgers/reviews/search-reaction.reviews.md`의 2026-04-22 기록은
  과거 대체 실행이 놓친 실패를 실제 경로에서 발견했다고 적는다. 당시 연속 실행 결과는 당시 근거이며 지금의
  구현이나 모든 LLM 출력의 성공을 보장하지 않는다. 이번 조사에서는 원본의 테스트와 외부 LLM 호출을 실행하지 않았다.

## 가져오지 않은 것과 아직 확인하지 않은 것

Story Chain의 전체 계층, 조직별 승인 권한, 별도 YAML 실행 원장, 종합 상태판, 전용 LLM 판정기와 모든 검사 명령은
복제하지 않는다. 원본의 `pk:start`, `pk:remember`, 자동 훅과 로컬 메모리 절차도 실행하거나 옮기지 않는다.
원본의 연구 제품 개념과 디자인 수치도 개인 학습의 요구로 바꾸지 않는다.

여섯 학습 약속의 승인은 대상 프로젝트에 이미 있다. 원본 자료는 그 승인을 다시 받게 하는 근거가 아니다.
이 절차가 개인 앱의 기획을 실제로 개선하는지는 아직 확인하지 않았다. 비교할 과업은 `../project.md`의
"절차를 비교해 볼 사례"에 있으며, 이 참고 기록을 실제 학습 수행이나 검증 성공의 근거로 사용하지 않는다.
