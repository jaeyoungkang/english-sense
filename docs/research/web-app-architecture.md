# 웹앱 아키텍처 조사

2026-10-26 공식 문서를 확인했다. [웹앱 아키텍처 모델](../../knowledge/domain/web-app-architecture.md)의 근거다.
대상은 화면·서버·저장소·외부 서비스의 책임과 의존성이다. 학습 방식의 효과, 제작 절차와 Next.js 기능별 사용법은 이 조사에 넣지 않는다.

## 자료에서 확인한 것

| 자료 | 확인한 내용 | 모델에 쓰는 범위와 한계 |
| --- | --- | --- |
| [Cloudflare Full-stack application](https://developers.cloudflare.com/workers/static-assets/routing/full-stack-application/) | 풀스택 빌드는 HTML·클라이언트 자산과 Worker 스크립트를 만들며 서버 응답 뒤 클라이언트가 상호작용을 이어 갈 수 있다 | 브라우저와 서버의 실행 책임이 갈라진다는 근거다. 모든 페이지에 SSR이 필요하다는 뜻은 아니다 |
| [Cloudflare Bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/) | 바인딩은 API와 권한을 함께 제공한다. 바인딩만 변경한 배포에서는 기존 isolate가 재사용될 수 있어 전역에 둔 파생 클라이언트가 옛 비밀 값을 유지할 수 있다 | 코드 이외의 실행 의존성이 동작을 바꾼다는 근거다. 바인딩은 앱 사용자의 인가를 대신하지 않는다 |
| [OWASP REST Security](https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html) | 입력의 길이·범위·형식·타입과 본문의 콘텐츠 유형을 검사한다. HTTP의 `no-store`만으로 앱 코드가 직접 저장하는 것을 막지 못한다 | API 계약과 신뢰 경계, 개인 응답의 재사용 조건을 다룬다. 타입 검사로 설명 내용의 참·거짓을 증명할 수는 없다 |
| [OWASP Authorization](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html) | 기본 거부를 택하고 요청마다 권한을 검사한다 | 요청의 신원과 자원별 동작 허용을 구별한다. 공개 콘텐츠까지 로그인해야 한다는 요구는 아니다 |
| [OWASP Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html) | 세션 쿠키의 `Secure`, `HttpOnly`, `SameSite`가 서로 다른 노출 경로를 줄인다. `SameSite`를 모든 CSRF 방지의 대체물로 보지 않는다 | 개인 인증을 구현할 때의 선택 근거다. 현재 앱에 세션 인증이 있다고 주장하지 않는다 |
| [Cloudflare Durable Objects storage](https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/) | 메모리는 퇴거나 배포로 사라질 수 있다. 객체의 영속 저장소는 비공개이며 트랜잭션과 강한 일관성을 제공한다 | 상태의 수명과 공유 범위를 구별한다. 객체의 메모리에 있다는 이유만으로 영속적이지 않다 |
| [Cloudflare D1 Database](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch) | `batch()`의 SQL 묶음은 트랜잭션이며 문장이 실패하면 전체를 롤백한다 | D1도 원자적 SQL 묶음을 제공한다. 외부 API 호출까지 SQL 트랜잭션으로 되돌린다는 뜻은 아니다 |
| [Cloudflare SQLite-backed Durable Object Storage](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/) | 객체마다 비공개 저장소가 있고 `transactionSync`는 동기 콜백을 트랜잭션으로 실행한다 | 같은 객체 안의 상태 변경 보장을 설명한다. 여러 객체와 외부 서비스까지 하나의 트랜잭션이라는 뜻은 아니다 |
| [Cloudflare D1 retry change](https://developers.cloudflare.com/changelog/post/2025-09-11-d1-automatic-read-retries/) | 읽기 전용 쿼리는 재시도할 수 있고, 쓰기는 앱의 업무 규칙에 따라 멱등적인 경우 재시도를 권한다 | 일시 실패와 무조건 반복을 구별한다. 사용자 동작 전체의 중복 효과는 앱이 판단해야 한다 |
| [Cloudflare Workers cache configuration](https://developers.cloudflare.com/workers/cache/configuration/) | `private`·`no-store`와 인증 관련 조건이 캐시 사용에 영향을 준다. `no-cache`는 저장 금지가 아니다 | 캐시의 저장 여부와 최신성 확인을 구별한다. 이 플랫폼의 특정 캐시를 현재 앱에 도입했다는 뜻은 아니다 |
| [Cloudflare Wrangler environments](https://developers.cloudflare.com/workers/wrangler/environments/) | 환경별 바인딩과 변수는 상속되지 않아 각 환경에 명시해야 한다 | 코드가 같아도 다른 자원·설정에 연결될 수 있다는 근거다 |
| [Cloudflare D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/) | SQL 파일로 데이터 구조 변경을 버전 관리하고 적용 기록을 DB에 남긴다 | 코드와 데이터 구조의 호환성을 판단하는 근거다. 코드 배포만으로 원격 DB 구조가 자동으로 맞는다고 보지 않는다 |

## 이 프로젝트에 적용한 추론

아래는 위 자료를 묶어 만든 설계 판단이다. 문헌이 이 개인 학습 앱에서 효과를 실험한 결과가 아니다.

- 화면은 사용자의 선택과 표시를 맡고, 서버 경계는 비용·권한·확정 상태의 불변 조건을 맡도록 책임을 나눈다.
  공개 자료를 읽는 일과 개인 기록을 바꾸는 일의 권한은 따로 정한다. 혼자 쓰려는 서비스도 인터넷에 공개되면 다른 요청자가 접근할 수 있다.
- 개인 기록에 SQL 조회와 관계가 필요하면 D1을 후보로 삼는다. 같은 키로 모이는 요청을 상태와 함께 조정할 필요가 있으면
  Durable Object를 후보로 삼는다. 제품 이름보다 함께 지켜야 할 불변 조건과 원자적 처리의 범위를 먼저 비교한다.
- LLM 호출, 사용량 반영과 결과 저장은 서로 다른 단계다. 호출 뒤 저장 실패나 응답 유실이 생길 수 있으므로
  무엇을 완료로 볼지와 재요청의 효과를 정해야 한다. 중복 요청 키를 DB에 둬도 공급자가 이미 처리한 호출까지 되돌리지는 못한다.
- 캐시의 키와 재사용 조건에는 결과를 가르는 입력과 권한 범위가 반영돼야 한다. 개인 기록을 캐시하려면 공개 자료의 캐시와
  달리 변경 직후 무엇을 보여 줄지, 로그아웃이나 권한 변경 뒤 사본을 어떻게 다룰지도 정해야 한다.
- 데이터 구조를 바꾸면 이전 코드가 그 구조를 읽고 쓸 수 있는지 따로 확인한다. 배포를 되돌리는 것과 데이터가 지닌 뜻을
  이전 상태로 복구하는 일은 다른 책임이다.

## Lighthouse에서 빌린 구조 기법

강PD가 `~/lighthouse`의 기획·구현 기법을 빌리라고 지시했다. 기준은 HEAD
`df85ac9a6f09c569d0e01b83ebdca4eebc996ea5`다. 아래 자료는 읽을 때 작업 트리 변경이 없음을 확인했다.
원본은 수정하지 않았고 작업 기억·훅·운영 스크립트를 실행하지 않았다. 링크는 그 커밋을 고정한다.

### 문서가 정한 규칙

| 자료 | 원본의 규칙 | 이 프로젝트에서 빌릴 판단 |
| --- | --- | --- |
| [Infrastructure state map](https://github.com/jaeyoungkang/lighthouse/blob/df85ac9a6f09c569d0e01b83ebdca4eebc996ea5/docs/infrastructure.md) | 영속 상태와 클라이언트 상태의 역할을 따로 적는다. 새 필드는 도메인 스키마에서 DB 매핑, 생성, UI 소비와 증거까지 연결한다 | 상태의 소유자·수명·소비 경로를 함께 본다. 타입 검사 통과를 데이터 전달 성공으로 보지 않는다 |
| [Implementation guide](https://github.com/jaeyoungkang/lighthouse/blob/df85ac9a6f09c569d0e01b83ebdca4eebc996ea5/docs/implementation.md) | 실행 위치와 허용 의존성으로 runtime zone을 나누고, 횡단 책임은 별도로 판단한다. 같은 불변 조건을 여러 호출 지점에 복제하지 않는다 | 디렉터리 이름만으로 영향이 없다고 판정하지 않고, 불변 조건을 책임질 가장 작은 공통 소유자를 찾는다 |
| [Conventions §2.1·§4](https://github.com/jaeyoungkang/lighthouse/blob/df85ac9a6f09c569d0e01b83ebdca4eebc996ea5/docs/conventions.md) | 공유 계약은 순수 모듈이 소유하고 타입·검사는 정본에서 파생한다. DB 접근 변경에서 원본 소유자, 읽는 때, 최신성·무효화, 실패 대안과 거부한 선택을 밝힌다 | 같은 뜻의 중복 선언을 줄이되, 저장·외부 공급자·화면의 형식 차이를 무조건 합치지 않는다 |
| [Runtime flows README](https://github.com/jaeyoungkang/lighthouse/blob/df85ac9a6f09c569d0e01b83ebdca4eebc996ea5/docs/runtime-flows/README.md)와 [API retry flow](https://github.com/jaeyoungkang/lighthouse/blob/df85ac9a6f09c569d0e01b83ebdca4eebc996ea5/docs/runtime-flows/api-response-and-retry.md) | 제품 기대와 기술 처리 순서, 깨지면 안 되는 실행 계약을 구별한다. 상태별 복구와 응답 유실 때 중복 가능성을 별도로 다룬다 | 서비스가 사용자에게 약속한 복구와 실제 서버의 재시도·저장 순서가 맞는지 본다. 단일 HTTP 성공 코드로 전체 완료를 대신하지 않는다 |
| [Architecture impact](https://github.com/jaeyoungkang/lighthouse/blob/df85ac9a6f09c569d0e01b83ebdca4eebc996ea5/docs/agent-skills.md#contract-architecture-impact-review)와 [Propagation map](https://github.com/jaeyoungkang/lighthouse/blob/df85ac9a6f09c569d0e01b83ebdca4eebc996ea5/docs/mission-control.md#minimum-owner-closure) | 승인된 기대가 상태 수명·권한·실패 정책을 바꾸면 현재 경계로 감당할지 판정한다. 바꾸는 소유자와 살펴보기만 할 하위 대상을 구별한다 | 개인 기록·이어 하기 도입은 화면 추가에 그치지 않는다. 소유자와 영향 경로를 밝혀 설계 변경을 제한한다 |
| [Architecture Fitness](https://github.com/jaeyoungkang/lighthouse/blob/df85ac9a6f09c569d0e01b83ebdca4eebc996ea5/docs/architecture-fitness/README.md) | 변경 영향 판정, 구조 준수의 검증 결과와 사람의 출시 판단을 합치지 않는다. 지원하지 않는 평가 범위는 `unknown`으로 둔다 | 정적 경계 검사 통과를 실행 안정성이나 학습 편리함의 증거로 확장하지 않는다 |

### 실제 코드에서 확인한 장치

- [`.dependency-cruiser.cjs`](https://github.com/jaeyoungkang/lighthouse/blob/df85ac9a6f09c569d0e01b83ebdca4eebc996ea5/.dependency-cruiser.cjs)에는
  클라이언트→서버, 공유 모듈→서버 런타임, 진입점→repository, service→repository의 금지 의존성이 있다.
  [`package.json`](https://github.com/jaeyoungkang/lighthouse/blob/df85ac9a6f09c569d0e01b83ebdca4eebc996ea5/package.json)의
  `deps:boundaries`가 그 설정을 읽는다. 문서에 원칙만 있는 것이 아니라 위반을 찾을 실행 수단이 있음을 확인했다.
  이 조사에서 실행하거나 탐지의 완전성을 증명하지는 않았다.
- [`inline-analysis-access.ts`](https://github.com/jaeyoungkang/lighthouse/blob/df85ac9a6f09c569d0e01b83ebdca4eebc996ea5/app/server/domain-access/inline-analysis-access.ts)는
  인증 진입점과 repository·외부 분석 서비스를 조합한다.
  [`paper-inline-analysis-cache.ts`](https://github.com/jaeyoungkang/lighthouse/blob/df85ac9a6f09c569d0e01b83ebdca4eebc996ea5/app/server/repository/paper-inline-analysis-cache.ts)는
  논문 ID·분석 판·입력 지문을 함께 확인해 캐시를 읽고 RPC 경계로 저장 작업을 요청한다. 캐시 키가 내용 판과 입력을
  포함한다는 코드 사례이며, 영어 감각에 같은 캐시를 구현해야 한다는 요구는 아니다.

### 적용 한계와 사전부검

Lighthouse의 조직별 소유자, Story Chain, 파일 수 checkpoint와 서명 검증 전체는 이 개인 앱에 옮기지 않는다.
원본의 여러 계층 이름을 먼저 복제하면 실제로 조정할 책임 없이 전달 함수와 문서만 늘 수 있다.
현재 앱에 필요한 것은 상태별 소유자, 공유 계약의 한 정본, 외부 호출과 저장의 실패 경계, 위반을 잡을 가장 작은 방어다.
문서가 정한 규칙과 코드에 그 장치가 있다는 사실만으로 개발 비용 감소나 장애 예방 효과를 입증한 것은 아니다.
그 효과는 이 프로젝트에서 같은 구조 판단을 배경에 둔 구현 결과로 확인해야 한다.

## 현재 구현에서 확인한 것과 아직 확인하지 않은 것

다음은 외부 자료의 주장과 구별한다. 파일은 이번 조사에서 읽었고, 운영 결과는 이 작업을 맡은 상위 에이전트의 검증 보고를
전달받았다. 여기서 운영 검사를 다시 실행하지 않았다.

| 근거 | 확인한 범위 | 확인하지 않은 범위 |
| --- | --- | --- |
| [`lib/server/api.ts`](../../lib/server/api.ts) | 브라우저 입력의 JSON·길이·바이트 수, 공급자 응답의 구조를 검사한다. 응답에 `no-store`를 설정하고 제한을 통과한 뒤 Claude를 부른다 | 문법 구조를 통과한 해설이 언어학적으로 맞다는 증거는 아니다 |
| [`lib/server/quota.ts`](../../lib/server/quota.ts) | 같은 날짜 객체의 SQLite 트랜잭션에서 전체 횟수와 IP 해시별 횟수를 함께 검사하고 올린다 | 개인 인증, 학습 기록, LLM 호출 실패 시 횟수 환불을 구현한 것이 아니다 |
| [`tests/quota.test.ts`](../../tests/quota.test.ts) | 동시 요청의 한도, 같은 저장소 재사용과 둘째 쓰기 실패 때 롤백을 확인하는 검사가 있다 | 파일을 읽은 사실은 이번 턴에 검사를 실행한 결과가 아니다 |
| 상위 작업의 배포 검증 보고 | `https://english-sense.jaeyoung2010.workers.dev`에 배포했고 실제 해설·번역 API가 200을 반환했다. 단위 검사 22개, 로컬 브라우저 검사 10개와 배포 브라우저 검사 10개를 통과했다고 보고받았다 | 강PD의 실제 학습 수행이나 편리함을 확인한 결과가 아니다. 운영 도메인 이전 완료의 근거로도 쓰지 않는다 |

현재 API의 Origin 검사와 IP별 한도는 개인 신원을 확인하지 않는다. 개인 기록을 저장하는 DB와 인증·인가는 아직 없다.
현재 한도는 해설 성공 수가 아니라 허용된 시도 수를 센다. 외부 호출이 실패해도 이미 반영한 횟수는 남는 구조다.
학습 기록 DB와 사용량을 묶는 상태 전이, 중복 요청 처리와 개인 캐시가 안전하게 동작한다는 검증은 남아 있다.

## 플랫폼 선택의 현재 한계

2026-10-26 확인한 [Cloudflare Next.js 안내](https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/)는
새 앱에 vinext를 기본 권장한다. [OpenNext 안내](https://developers.cloudflare.com/workers/framework-guides/web-apps/opennext/)는
기존 OpenNext 앱을 유지할 때 쓰고, 호환성이 허용하면 vinext로 이행하라고 적는다. 현재 앱은 OpenNext를 쓴다.
이 조사만으로 바꾸지 않으며, 현재 기능과 의존성의 호환 범위를 비교해야 한다. 프레임워크별 판단은 Next.js 개발 모델이 맡는다.

Cloudflare의 제품 기능과 한도는 바뀔 수 있다. 여기서 일반화한 것은 책임·신뢰·수명·원자성의 관계이며 특정 제품의 영구 우위가 아니다.
R2, Queues와 Workflows는 현재 필요한 업로드나 장기 작업이 없어 선택 근거를 조사하지 않았다.
