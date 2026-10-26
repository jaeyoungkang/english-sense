# Lighthouse의 기획·구현 기법 조사

2026-10-26 강PD가 Lighthouse의 기획과 구현 기법을 모델과 스킬로 차용하도록 지시했다.
조사 대상은 `~/lighthouse`의 `df85ac9a6f09c569d0e01b83ebdca4eebc996ea5`다.
원문 문서와 코드·테스트를 읽었고, 해당 프로젝트의 테스트나 기억·훅 명령은 실행하지 않았다.
이 문서는 원문 사실, 이식 판단과 이번 서비스 전환의 관찰을 나눈다.

## 원문에서 확인한 것

| 기법 | 문서의 내용 | 코드나 사례에서 확인한 범위 |
| --- | --- | --- |
| 사용자 약속과 검증을 연결한다 | 제품 의미, 사용자 상황, 약속과 수용 조건, 실행 근거를 연결한다 | 검색 조건 전환의 Promise와 Evidence Ledger가 검색창 DOM 검사, 이전 route 상태 비노출과 정리 검사를 연결한다 |
| 보이는 결과의 상류 조건도 확인한다 | 이미 올바른 데이터를 넣은 fixture 화면만으로 실제 생성·저장·복원 경로를 확인했다고 보지 않는다 | route-owned-render 검사는 이전 데이터를 넣고 새 route의 첫 프레임과 unmount 처리를 확인하도록 작성돼 있다 |
| 제품 의미와 기술 선택의 자리를 나눈다 | 사용자가 기대할 결과는 제품 계약이, 현재 구조와 기술 처리 순서는 구현 정본이 소유한다 | 내부 관리 화면을 없애고 운영 계산을 스크립트로 옮긴 결정에는 이전·선택 담당 위치와 이유가 남아 있다 |
| 기대가 구조를 바꾸는지 본다 | 상태 수명·복원·동시성·권한·외부 서비스 경계가 바뀌면 현재 구조의 충분함을 검토한다 | 영향 결과를 현 구조 유지, 기존 경계에 제약 추가, 구조 변경으로 나누고 거부 대안과 검증을 남긴다 |
| 실패하면 방향이 달라질 가정만 먼저 실행한다 | 가장 큰 미검증 가정을 실제 제품 경계에서 작은 실행으로 확인한다. CLI 자체가 목적은 아니다 | 맞춤법 교정 route 테스트는 실제 POST export를 호출하고 외부 서비스를 주입해 입력·인증·제한·응답을 확인하도록 작성돼 있다 |
| 실행 위치와 규칙의 담당 위치를 나눈다 | UI·HTTP·서버 응용·저장·공유 계약은 실행 위치이며, 제품 의미·보안·처리 순서의 영향은 별도로 본다 | 공용 교정 schema를 route와 UI hook이 소비하고 import 검사가 client/shared에서 server runtime으로의 역참조를 막는다 |
| 응답의 수명을 현재 작업에 묶는다 | route 수명의 작업과 특정 renderer 수명의 작업을 다른 담당 위치에 둔다 | 교정 hook은 실행·원본 snapshot·query를 대조하고, 늦은 응답과 중단을 검사하는 테스트가 있다 |
| 필요한 변경과 후속 영향을 구분한다 | 승인된 약속을 성립시키는 최소 경로와 읽기만 할 후속 영향을 분리한다 | 리뷰 기록에는 route 이탈 때의 작업 중단 검사가 빠진 것을 발견하고 추가한 당시 기록이 있다 |

위 표는 선언과 구현의 연결을 확인한 것이다. 이 방식 때문에 효과가 나아졌는지, 현재 HEAD의 모든 검사가 통과하는지,
처음 개발할 때 가정을 실제로 먼저 실행했는지는 이 조사만으로 확인하지 않았다.

## 고정 출처

아래 링크는 모두 같은 원문 커밋을 가리킨다.

- [제품 원칙과 현재 상태의 설명](https://github.com/jaeyoungkang/lighthouse/blob/df85ac9a6f09c569d0e01b83ebdca4eebc996ea5/docs/product-identity.md)
- [Mission Control의 Chain Closure·Minimum Owner Closure·구조 영향 검토](https://github.com/jaeyoungkang/lighthouse/blob/df85ac9a6f09c569d0e01b83ebdca4eebc996ea5/docs/mission-control.md)
- [최소 실행과 중립 계약 담당 위치](https://github.com/jaeyoungkang/lighthouse/blob/df85ac9a6f09c569d0e01b83ebdca4eebc996ea5/docs/conventions.md)
- [실행 위치와 구현 순서](https://github.com/jaeyoungkang/lighthouse/blob/df85ac9a6f09c569d0e01b83ebdca4eebc996ea5/docs/implementation.md)
- [제품 내용과 구조 내용의 담당 위치](https://github.com/jaeyoungkang/lighthouse/blob/df85ac9a6f09c569d0e01b83ebdca4eebc996ea5/shared-skills/mission-control/references/product-architecture-content-ownership.md)
- [검색 전환 약속](https://github.com/jaeyoungkang/lighthouse/blob/df85ac9a6f09c569d0e01b83ebdca4eebc996ea5/docs/contracts/story-chain/promises/search-query-route-transition.md)
- [검색 전환의 수용 근거 연결](https://github.com/jaeyoungkang/lighthouse/blob/df85ac9a6f09c569d0e01b83ebdca4eebc996ea5/docs/contracts/story-chain/evidence-ledgers/search-query-route-transition.ledger.yaml)
- [실제 맞춤법 교정 HTTP 경계](https://github.com/jaeyoungkang/lighthouse/blob/df85ac9a6f09c569d0e01b83ebdca4eebc996ea5/app/api/search/spelling-correction/route.ts)
- [교정 route의 경계 검사](https://github.com/jaeyoungkang/lighthouse/blob/df85ac9a6f09c569d0e01b83ebdca4eebc996ea5/app/api/search/spelling-correction/__tests__/route.test.ts)
- [기술 처리 순서 문서의 범위](https://github.com/jaeyoungkang/lighthouse/blob/df85ac9a6f09c569d0e01b83ebdca4eebc996ea5/docs/runtime-flows/README.md)

## 이 서비스에 옮기는 판단

| 담을 곳 | 차용하는 이해나 방법 |
| --- | --- |
| 웹앱 제작 모델 | 사용자 과업과 약속, 수용 조건, 상류 의존성, 근거의 범위와 작은 실행의 이유 |
| 웹앱 아키텍처 모델 | 규칙·상태의 담당 위치, 공용 계약, 의존 방향, 구조 변화와 실패·수명의 관계 |
| Next.js 개발 모델 | route·컴포넌트·대기 경계와 비동기 작업 수명을 실제 프레임워크 의미에 맞추는 원리 |
| 기획 스킬 | 승인된 사용자 과업을 수용 조건·구조 영향·최소 변경 경로와 검증 계획으로 연결한다 |
| 구현 스킬 | 미검증 가정을 실제 경계에서 확인하고 담당 위치 안에서 구현한 뒤 실행 근거를 연결한다 |

각 모델은 기법이 왜 필요한지와 언제 맞는지를, 스킬은 그 일을 수행하는 순서와 판단할 자리를 소유한다.
현재 작은 서비스에는 작업 계약 한 문서와 그 안의 수용 근거 표를 쓴다. 별도 계획·판정·실행 원장을 각각 만들지 않는다.
Lighthouse의 제품 개념, 기억·훅 체계, 조직별 역할, 수치 문턱과 대규모 검사 도구는 가져오지 않았다.
이식한 절차가 이 서비스의 개발을 개선했는지는 아직 확인하지 않았다.

## 공식 자료와 대조

- React는 중복·모순 상태를 줄이고 함께 바뀌는 상태의 소유자를 정하도록 설명한다. [상태 구조](https://react.dev/learn/choosing-the-state-structure)
- Next.js는 클라이언트와 서버의 모듈 경계, hydration과 데이터 접근 경계를 설명한다. [컴포넌트 경계](https://nextjs.org/docs/app/getting-started/server-and-client-components), [데이터 보안](https://nextjs.org/docs/app/guides/data-security)
- Playwright는 사용자에게 보이는 행동을 검사하고 테스트를 독립시키도록 권한다. 준비된 외부 응답을 쓰는 검사는 해당 외부 서비스의 실제 동작을 입증하지 않는다. [검사 원칙](https://playwright.dev/docs/best-practices)
- W3C는 기다림·성공·오류 같은 상태 알림을 보조 기술이 인식할 수 있게 하고 키보드 초점을 가리지 않도록 설명한다. [상태 알림](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html), [초점](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html)

이는 위 기법을 우리 서비스에 맞추는 참고 자료다. Lighthouse 방식 전체의 효과를 입증하는 연구 결과로 취급하지 않는다.

## 이번 전환에서 관찰한 것

다음은 에이전트의 구현 검증 기록이며 강PD의 learn 기록이 아니다.

- 기존 12개 공개 페이지, 문제 30개와 쓰임 전환 26개를 이관 자료와 대조했다.
- 자산의 Worker 우선 처리 설정을 바꾼 뒤 이전 빌드 산출물을 쓰자 HTML은 보였지만 JS·CSS 요청이 404가 되어 조작이 동작하지 않았다. 같은 설정으로 다시 빌드해 해결했다.
- 타입·단위 검사만으로 이 실패를 발견하지 못했고, 실제 Workers 브라우저 검사에서 확인했다. 이 사례 하나로 모든 웹앱에 같은 검증 비용을 요구하지 않는다.
- Next 개발 서버의 내부 Durable Object 제약과 실제 Workers 실행을 구분했다. 같은 배포물의 PC·모바일 브라우저 검사 10개와 실제 영어 해설·한국어 변환 요청을 Workers 주소에서 확인했다.
- 현재 개인 학습 기록 저장·인증·복원은 구현하지 않았다. 공개 운영 도메인은 아직 GitHub Pages를 가리킨다.

현재 실행과 배포 상태는 `docs/architecture.md`, `docs/cloudflare-migration.md`와 상태판이 안내한다.
