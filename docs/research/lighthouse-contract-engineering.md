# Lighthouse의 계약 설계와 엔지니어링 상세 조사

2026-10-26 강PD가 계약 설계부터 엔지니어링 방법까지 상세히 참고하도록 지시했다.
기준은 Lighthouse `df85ac9a6f09c569d0e01b83ebdca4eebc996ea5`다. 세 에이전트가 계약·엔지니어링·디자인을
나누어 문서와 코드·테스트를 읽었다. 원본 테스트·훅·기억 명령은 실행하지 않았고 원본 파일은 수정하지 않았다.
여기서 '검사가 있다'는 것은 코드를 확인했다는 뜻이며, 해당 HEAD의 통과나 운영 효과를 확인했다는 뜻이 아니다.
이전 개요는 `lighthouse-methods.md`, 디자인 조사는 `web-app-ux-design.md`에 있다.

## 계약을 구성하는 세 축

[계약 개념](https://github.com/jaeyoungkang/lighthouse/blob/df85ac9a6f09c569d0e01b83ebdca4eebc996ea5/docs/contracts/story-chain/concepts.md#L3-L35)은 단일 계층 트리만 설명하지 않는다.

| 축 | 연결 | 역할 |
| --- | --- | --- |
| 의도 | Experience → Moment → Promise | 지속할 사용자 가치, 기대가 발동하는 순간, 그 순간의 종단 보장을 구분한다 |
| 횡단 제약 | Aspect → 여러 Promise | 여러 약속이 공유하는 제약을 적용한다 |
| 증명 | Promise → Evidence Ledger → Code / Tests | 약속의 수용 조건과 실제 근거를 연결한다 |

상위 항목이나 Aspect가 Promise를 자동 생성하지 않는다. 어떤 보장을 채택하는지 명시한다.
[계약 계층 판정](https://github.com/jaeyoungkang/lighthouse/blob/df85ac9a6f09c569d0e01b83ebdca4eebc996ea5/shared-skills/mission-control/references/contract-layer-routing.md#L18-L72)은
기술 단어의 유무보다 '어떤 변화가 이 문장을 거짓으로 만드는가'를 묻는다. 공유·복원 의미가 있는 주소는 제품 계약일 수 있지만,
현재 라우터의 철자만 바뀌는 것은 엔지니어링 정본의 일이다.

## 계약을 쓰기 전에 남은 정책을 찾는다

[서비스 정책 검토](https://github.com/jaeyoungkang/lighthouse/blob/df85ac9a6f09c569d0e01b83ebdca4eebc996ea5/docs/mission-control.md#L91-L141)는
입력·품질·출처·결과 범위·실패와 복구·상태 수명·접근과 보호·운영·호환과 종료를 살펴
각각 채택한 것, 지원하지 않기로 한 것, 미결인 것으로 구분한다. 구현 부재는 지원 결정과 다르고 공급자 지원은 서비스 충족과 다르다.
내부 처리 순서·보안·용량을 모두 사용자 약속으로 바꾸지도 않는다.

실제 [핵심 Experience](https://github.com/jaeyoungkang/lighthouse/blob/df85ac9a6f09c569d0e01b83ebdca4eebc996ea5/docs/contracts/story-chain/experiences/research-and-discovery.md#L6-L7)는
`servicePolicyCoverage: unresolved`다. 개별 Promise의 `met`를 서비스 전체 출시 완료로 읽을 수 없다.
우리 앱에는 별도 정책 관리 시스템 대신 과업 계약의 해당 정책·미결 선택 표로 적용한다. 이 판단은 규모에 맞춘 이식 가설이다.

## 의미·구현·근거의 소유권

[내용 소유권](https://github.com/jaeyoungkang/lighthouse/blob/df85ac9a6f09c569d0e01b83ebdca4eebc996ea5/shared-skills/mission-control/references/product-architecture-content-ownership.md#L27-L127)은
사용자 보장은 유지하고, 보장과 기법이 섞였으면 분리하며, 내부 기법은 엔지니어링 정본으로 옮기고, 검사 방법은 근거에 둔다.
구현 이름만 바뀌었으면 약속의 정체성을 바꾸지 않는다. 참·거짓 기준이 바뀌었으면 같은 조건을 몰래 재사용하지 않는다.
목표 구조와 현재 코드가 다르면 목표를 현 상태에 맞춰 지우지 않고 차이를 드러낸다.

[구조 영향 검토](https://github.com/jaeyoungkang/lighthouse/blob/df85ac9a6f09c569d0e01b83ebdca4eebc996ea5/shared-skills/mission-control/references/contract-architecture-impact-review.md#L14-L123)는
반응 시점, 값의 모양, 정본·권한, 수명·복원, 순서·동시성·취소, 외부 호출, 보호, 용량·비용, 식별성, 호환·은퇴를 살핀다.
기존 경계로 충분한 경우, 그 경계에 제약을 더하는 경우, 책임·경계를 재구성하는 경우를 나눈다.
현재·선택한 소유자, 이유, 거부 대안, 방어와 검사를 잇는다. validator가 항목과 참조를 확인해도 선택의 적절함까지 판정하지는 못한다.

[변경 전파 범위](https://github.com/jaeyoungkang/lighthouse/blob/df85ac9a6f09c569d0e01b83ebdca4eebc996ea5/shared-skills/mission-control/references/propagation-scope-control.md#L23-L100)는
직접 소유자와 입증 경로, 읽고 영향만 확인할 곳, 호환 부분, 별도 정리를 나눈다.
원문의 파일·줄·bundle 수는 재논의 신호이며 우리 CI의 실패 문턱으로 복제하지 않는다.

## 추적 사례 1 — 새 검색에 이전 실행이 섞이지 않는다

| 단계 | 고정 출처와 확인한 내용 |
| --- | --- |
| 사용자 상황 | [제품 정체성 41~45행](https://github.com/jaeyoungkang/lighthouse/blob/df85ac9a6f09c569d0e01b83ebdca4eebc996ea5/docs/product-identity.md#L41-L45): 진행·완료·부분 제공·실패와 다음 행동을 구분한다 |
| 약속·수용 조건 | [query 전환 Promise 34~42·90~94행](https://github.com/jaeyoungkang/lighthouse/blob/df85ac9a6f09c569d0e01b83ebdca4eebc996ea5/docs/contracts/story-chain/promises/search-query-route-transition.md#L34-L94): 새 조건으로 실행하고, 첫 프레임부터 이전 route 잔재를 배제하며 떠난 실행을 정리한다 |
| 근거 매핑 | [전환 ledger 65~70·91~95행](https://github.com/jaeyoungkang/lighthouse/blob/df85ac9a6f09c569d0e01b83ebdca4eebc996ea5/docs/contracts/story-chain/evidence-ledgers/search-query-route-transition.ledger.yaml#L65-L95): Runtime·BackgroundTasks 검사를 수용 조건에 연결한다 |
| 렌더 책임 | [ResearchRouteRuntime 47~120행](https://github.com/jaeyoungkang/lighthouse/blob/df85ac9a6f09c569d0e01b83ebdca4eebc996ea5/app/components/research/ResearchRouteRuntime.tsx#L47-L120): 실행·뷰 식별성을 대조하고 hydration 전에는 route가 준 뷰를 사용한다 |
| 작업 수명 | [ResearchBackgroundTasks 89~126행](https://github.com/jaeyoungkang/lighthouse/blob/df85ac9a6f09c569d0e01b83ebdca4eebc996ea5/app/components/research/ResearchBackgroundTasks.tsx#L89-L126): 다른 실행의 controller를 abort하고 이전 inline 작업을 버린다 |
| 실제 작성된 검사 | [첫 렌더 검사 144~184행](https://github.com/jaeyoungkang/lighthouse/blob/df85ac9a6f09c569d0e01b83ebdca4eebc996ea5/app/components/research/__tests__/ResearchRouteRuntime.route-owned-render.test.tsx#L144-L184): 외부 뷰를 store에 먼저 넣고 수집한 모든 렌더에 나오지 않는지 검사한다 |

교정 요청에서도 실행·snapshot·query를 시작과 응답 뒤에 다시 대조한다.
[요청 hook 38~161행](https://github.com/jaeyoungkang/lighthouse/blob/df85ac9a6f09c569d0e01b83ebdca4eebc996ea5/app/components/research-route-renderers/use-search-spelling-correction-request.ts#L38-L161)은
abort를 무시하는 전송에도 별도 취소·timeout 경로를 두고, 응답 전체가 아니라 correction 필드만 현재 상태에 병합한다.
[검사 156~325행](https://github.com/jaeyoungkang/lighthouse/blob/df85ac9a6f09c569d0e01b83ebdca4eebc996ea5/app/components/research-route-renderers/__tests__/search-view-content.spelling-correction.test.tsx#L156-L325)은
remount 중 중복 요청, abort 무시 timeout, 같은 view ID의 새 실행, 최신 enrichment 보존을 각각 다룬다.

우리 앱의 이식 가설은 문제·시도·입력 버전과 비동기 실행을 구분하고, 이전 피드백이 새 답을 덮지 않게 하는 것이다.
취소 요청과 응답 채택 조건은 별도 방어다. 원문의 module-level request map은
[conventions 143~145행](https://github.com/jaeyoungkang/lighthouse/blob/df85ac9a6f09c569d0e01b83ebdca4eebc996ea5/docs/conventions.md#L143-L145)에서 기존 예외로 명시하므로 새 표준으로 옮기지 않는다.

## 추적 사례 2 — 응답 유실을 저장 실패로 단정하지 않는다

| 단계 | 고정 출처와 확인한 내용 |
| --- | --- |
| 약속 | [prepared reaction Promise 81~85행](https://github.com/jaeyoungkang/lighthouse/blob/df85ac9a6f09c569d0e01b83ebdca4eebc996ea5/docs/contracts/story-chain/promises/gap-report-prepared-reaction.md#L81-L85): 현재 가입자의 선호를 저장하며 다른 가입자·공유 본문을 바꾸지 않는다 |
| 처리 순서 | [runtime flow 296~331행](https://github.com/jaeyoungkang/lighthouse/blob/df85ac9a6f09c569d0e01b83ebdca4eebc996ea5/docs/runtime-flows/gap-network-analysis.md#L296-L331): 즉시 표시·직렬 write·retry·read-back·version guard·충돌 rebase·확정 거절을 나눈다 |
| 클라이언트 조정 | [write coordinator 44~224행](https://github.com/jaeyoungkang/lighthouse/blob/df85ac9a6f09c569d0e01b83ebdca4eebc996ea5/app/components/research-route-renderers/gap-reaction-write-coordinator.ts#L44-L224): 실행·문서·버전 대조와 active/pending write로 늦은 확인이 새 선택을 덮지 않게 한다 |
| 전송·불명 결과 | [write transport 40~267행](https://github.com/jaeyoungkang/lighthouse/blob/df85ac9a6f09c569d0e01b83ebdca4eebc996ea5/app/components/research-route-renderers/gap-reaction-write-transport.ts#L40-L267): 같은 의미의 재시도, 조회 확인, 충돌 뒤 재조회와 terminal 오류를 구분한다 |
| 서버·권한 | [reaction route 86~187행](https://github.com/jaeyoungkang/lighthouse/blob/df85ac9a6f09c569d0e01b83ebdca4eebc996ea5/app/api/gap-reports/%5Bid%5D/reaction/route.ts#L86-L187), [domain access 23~56행](https://github.com/jaeyoungkang/lighthouse/blob/df85ac9a6f09c569d0e01b83ebdca4eebc996ea5/app/server/domain-access/gap-report-access.ts#L23-L56): 인증에서 viewer를 구하고 준비된 의미·base version을 검사한다 |
| 저장 | [repository 251~367행](https://github.com/jaeyoungkang/lighthouse/blob/df85ac9a6f09c569d0e01b83ebdca4eebc996ea5/app/server/repository/gap-reports.ts#L251-L367): viewer·artifact 범위와 조건부 버전 갱신을 사용한다 |
| 작성된 검사 | [read-back 검사 87~252행](https://github.com/jaeyoungkang/lighthouse/blob/df85ac9a6f09c569d0e01b83ebdca4eebc996ea5/app/components/research-route-renderers/__tests__/GapNetworkView.persistence-readback.test.tsx#L87-L252): PUT 응답 유실 뒤 조회에서 commit을 찾으며 첫 조회가 오래된 경우도 다룬다 |

우리 앱에는 제출된 수행의 식별성과 사용자·자료 버전에 맞는 복원을 검토할 근거가 된다. 저장 결과가 불명인 요청을
바로 새 요청으로 취급하지 않고 같은 수행의 저장 확인·재시도 의미를 먼저 정해야 한다.
다만 '최신 pending 선택만 남기기'는 선호 선택의 정책이다. 처음 답·수정·질답에 그대로 적용하면 학습 수행을 잃는다.
Supabase repository나 재시도 횟수를 복제하지 않고 필요한 내구성·원자성·권한에서 Workers 저장 방식을 고른다.

## 타입·실행 방어·검사는 서로 대체하지 않는다

- [중립 전송 계약 278~297행](https://github.com/jaeyoungkang/lighthouse/blob/df85ac9a6f09c569d0e01b83ebdca4eebc996ea5/app/domain/search-background-transport.ts#L278-L297)은 schema에서 타입을 파생한다. effectful provider나 repository가 공용 의미를 소유하지 않게 한다.
- [기존 값 읽기와 새 변경 parser 34~46행](https://github.com/jaeyoungkang/lighthouse/blob/df85ac9a6f09c569d0e01b83ebdca4eebc996ea5/app/domain/route-ai-comment.ts#L34-L46)은 정책이 다르다. 읽기 호환의 관대한 복구를 새 입력 허용으로 확대하지 않는다.
- [의존성 방어 설정](https://github.com/jaeyoungkang/lighthouse/blob/df85ac9a6f09c569d0e01b83ebdca4eebc996ea5/.dependency-cruiser.cjs#L20-L117)은 import 경계를 확인한다. 늦은 응답·저장 유실·복원 결과는 별도 실행 근거가 필요하다.
- [상류 검증 원칙 74~78행](https://github.com/jaeyoungkang/lighthouse/blob/df85ac9a6f09c569d0e01b83ebdca4eebc996ea5/docs/mission-control.md#L74-L78)은 생성·저장·분기 선택이 전제면 그 경로도 확인하게 한다. 완성된 fixture 화면만으로는 부족하다.
- [최소 실행 9~69행](https://github.com/jaeyoungkang/lighthouse/blob/df85ac9a6f09c569d0e01b83ebdca4eebc996ea5/docs/conventions.md#L9-L69)은 실패하면 설계가 바뀔 가정에 한한다. 실제 seam을 통과하고 일회 도구에 업무 로직을 복제하지 않는다.

우리 앱의 첫 실제 저장 유닛은 입력→저장→재조회→복원까지 통과해야 한다. 이번 디자인 시안은 localStorage만
구현하므로 이 운영 경로를 입증하지 않는다. mock repository 검사의 존재도 실제 DB 격리·운영 성능의 근거가 아니다.

## 조사 중 확인한 불일치와 근거의 한계

| 관찰 | 정합성 또는 증거의 한계 |
| --- | --- |
| [공통 Aspect 43~45행](https://github.com/jaeyoungkang/lighthouse/blob/df85ac9a6f09c569d0e01b83ebdca4eebc996ea5/docs/contracts/story-chain/aspects/context-preserving-transitions.md#L43-L45)은 이전 snapshot 복구라고 한다 | 현재 query 전환 Promise는 history의 조건 재실행이다. [리뷰 72~74행](https://github.com/jaeyoungkang/lighthouse/blob/df85ac9a6f09c569d0e01b83ebdca4eebc996ea5/docs/contracts/story-chain/evidence-ledgers/reviews/search-query-route-transition.reviews.md#L72-L74)도 snapshot 복구 폐기를 밝힌다 |
| [교정 서비스 검사 58~70행](https://github.com/jaeyoungkang/lighthouse/blob/df85ac9a6f09c569d0e01b83ebdca4eebc996ea5/app/server/services/__tests__/search-spelling-correction-service.test.ts#L58-L70)은 timeout/failure라는 이름이다 | 판단 응답을 null로 mock하고 fallback 설정을 본다. 실제 provider timeout을 유발한 증거로 읽지 않는다 |
| [리뷰 104~124행](https://github.com/jaeyoungkang/lighthouse/blob/df85ac9a6f09c569d0e01b83ebdca4eebc996ea5/docs/contracts/story-chain/evidence-ledgers/reviews/search-query-route-transition.reviews.md#L104-L124)은 누락된 enrichment abort 검사를 추가했다고 기록한다 | 당시 리뷰 기록과 이번 HEAD 재실행은 다르다. 이번에는 작성된 검사만 읽었다 |
| 디자인 문서는 구조 검사와 값의 좋음을 구분한다 | 실제 visual hierarchy 검사는 토큰값도 확인한다. 자세한 경로와 한계는 `web-app-ux-design.md`에 있다 |

원본의 모든 문서가 정합적이라는 전제로 옮기지 않는다. 충돌한 제품 의미·구현 사실·과거 기록을 분리하고,
우리 선택은 승인된 요구에 맞춰 적는다. Lighthouse의 검색 교정 실패를 조용히 무시하는 정책은 그 제품 선택이며,
영어 학습의 피드백 실패도 숨겨야 한다는 일반 규칙으로 가져오지 않는다.

## 이 프로젝트에 적용하는 자리

| 소유자 | 이번에 가져오는 판단 |
| --- | --- |
| 웹앱 제작 모델 | 약속·정책·수용 조건·근거의 범위, 사용자 의미와 구현 변경, 목표와 관찰의 구분 |
| UX 모델 | 수행 맥락, 행동 뒤의 상태, 점진적 공개, 복구·재개, 역할 중심 시각 체계 |
| 아키텍처 모델 | 정본·수명·사용자와 버전 범위, 결과 불명, 취소와 늦은 응답 채택, 순수 계약과 호환 정책 |
| Next.js 모델 | route/layout/component 식별성과 실제 실행 수명, 렌더·hydration·기다림 경계 |
| 기존 기획·구현 스킬 | 같은 작업 계약 안에서 정책·디자인·구조 영향·실제 경로·근거를 연결한다 |

Story Chain 전체 폴더·전용 ledger runner·조직 권한·메모리·훅·전체 gate를 복제하지 않는다.
현재 앱은 `docs/tasks/<과업>.md` 하나에서 조건과 근거를 연결하고 필요한 경우 실제 구조 문서를 고친다.
추가 계약 관리 계층이나 별도 스킬은 현재 기획·구현 절차로 감당하지 못하는 사례가 생기면 다시 본다.
이 상세 차용이 개발 결과와 UX를 개선하는지는 아직 확인하지 않았다.
