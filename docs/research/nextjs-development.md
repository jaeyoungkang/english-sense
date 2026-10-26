# Next.js 개발 모델의 조사 근거

2026-10-26에 Next.js·React 공식 문서와 이 프로젝트의 코드·설정을 대조했다. 모델은
`knowledge/domain/nextjs-development.md`에 있다. 아래 S 번호는 그 문서의 근거를 가리킨다.
외부 문서의 설명, 이 프로젝트의 사실, 그로부터 도출한 판단을 구분한다.

## 공식 문서에서 확인한 내용

| 번호 | 1차 출처 | 원문에서 확인한 설명 | 모델에 옮긴 범위와 한계 |
| --- | --- | --- | --- |
| S1 | [Layouts and Pages](https://nextjs.org/docs/app/getting-started/layouts-and-pages) | 파일·폴더가 경로를 정하고 레이아웃은 경로 이동 때 상태를 유지한다. `generateStaticParams`로 경로를 미리 만들 수 있다. | 경로 트리와 상태의 수명을 연결했다. 모든 문제의 상태를 어디에 둘지는 이 문서가 정하지 않는다. |
| S2 | [Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components) | 서버·클라이언트의 실행 능력이 다르다. `'use client'`는 모듈 경계다. 첫 방문에는 HTML을 보인 뒤 Client Component를 hydration한다. props는 직렬화할 수 있어야 하며 `server-only`는 잘못된 가져오기를 빌드 오류로 드러낸다. | 화면의 중첩과 모듈 의존 관계를 구분했다. Client Component가 HTML로 보인다는 사실은 이벤트가 연결됐다는 증거가 아니다. |
| S3 | [Choosing the State Structure](https://react.dev/learn/choosing-the-state-structure) | 함께 바뀌는 상태를 묶고, 모순되는 상태와 계산할 수 있는 중복 값을 줄이도록 권한다. props를 상태로 복사하면 첫 렌더 이후 props와 어긋날 수 있다고 설명한다. | 경로에서 읽은 문제 ID를 별도 상태로 복사하지 않는 판단에 적용했다. 영구 기록의 서버 소유는 이 앱의 미구현 기능을 위한 제안이다. |
| S4 | [Data Security](https://nextjs.org/docs/app/guides/data-security) | 서버 전용 데이터 접근 계층이 권한을 확인하고 최소 DTO를 반환하도록 권한다. Action 입력과 권한을 확인하고 반환값도 좁힌다. 변경 뒤 `revalidatePath`를 호출하는 예를 보인다. 렌더링 때 변경을 일으키지 않도록 설명한다. | 서버에서 실행한다는 것과 입력을 믿는 것을 구분하고 데이터 계약을 연결했다. 무효화의 범위와 변경 처리의 원자성을 이 문서만으로 결정하지 않는다. |
| S5 | [use cache](https://nextjs.org/docs/app/api-reference/directives/use-cache) | `cacheComponents`를 켜야 쓰는 기능이다. 키에 빌드·함수·직렬화한 인수와 캡처한 값이 들어간다. 일반 `use cache` 안에서는 쿠키를 직접 읽을 수 없다. 기본 메모리 저장의 재사용은 실행 환경에 달린다. | 설치 패키지의 같은 문서와 기본 설정도 대조했다. 현재 기능은 꺼져 있다. 경로 사전 생성, 서버 데이터 재사용, 브라우저의 경로 재사용을 전부 `use cache`라고 부르지 않는다. 일반 캐시의 재사용·최신성 원리는 아키텍처 모델이 맡는다. |
| S6 | [Deploying](https://nextjs.org/docs/app/getting-started/deploying) | Node.js 서버, 정적 내보내기, 플랫폼 어댑터는 지원 기능이 다르다. 어댑터의 지원 범위는 플랫폼 문서에서 확인하도록 안내한다. | Next.js 기능의 존재만으로 Cloudflare 지원을 단정하지 않는다. 이 조사에서는 Cloudflare 기능별 지원표를 새로 검증하지 않았다. |
| S7 | [Playwright](https://nextjs.org/docs/app/guides/testing/playwright) | 브라우저로 이동을 자동화하며 실제 배포 동작에 가깝도록 production 코드로 검사하기를 권한다. | 본문뿐 아니라 조작 결과를 검사한다는 판단의 근거다. Next.js production 서버 검사도 Workers 바인딩을 검증한 것은 아니다. |
| S8 | [Preserving and Resetting State](https://react.dev/learn/preserving-and-resetting-state) | React 상태는 렌더 트리의 위치와 컴포넌트 식별성에 연결된다. 같은 위치·타입·`key`를 유지하면 props만 바뀌어도 상태는 남는다. 다른 `key`로 하위 트리를 다시 만들면 상태를 초기화한다. 이전 입력을 복원하려면 상위 소유자나 별도 저장 경로가 필요하다. | 관계 4와 규칙 3에 문제 전환의 조건을 보완했다. 문제별 컴포넌트로 옮기는 것만으로 초기화를 보장하지 않는다. 현재 앱에서 그 결함을 재현했다는 주장은 아니다. |

Next.js 문서는 열람 당시 최신판을 16.4.3으로, React 문서는 19.3으로 표시했다. 같은 주요 버전이어도 설정과
세부 버전이 다를 수 있다. 특히 Cache Components를 전제한 현재 문서를 이전 캐싱 모델에 그대로 옮기지 않는다.

## Lighthouse의 구체적인 구현 근거 [L1]

원본은 Lighthouse `df85ac9a6f09c569d0e01b83ebdca4eebc996ea5`다. 원본은 읽기만 했고 명령·훅·로컬 기억을
실행하거나 변경하지 않았다. 아래 링크는 같은 커밋을 고정한다. 테스트는 코드를 읽었으며 이번 조사에서 실행하지 않았다.

| 구분 | 확인한 자료와 사실 | 이 앱으로 옮기는 판단과 경계 |
| --- | --- | --- |
| 원본 규칙 | [구현 진입점](https://github.com/jaeyoungkang/lighthouse/blob/df85ac9a6f09c569d0e01b83ebdca4eebc996ea5/docs/implementation.md)은 실행 위치와 import 방향으로 runtime zone을 나눈다. [구현 규칙](https://github.com/jaeyoungkang/lighthouse/blob/df85ac9a6f09c569d0e01b83ebdca4eebc996ea5/docs/conventions.md)은 Server Component 기본값, 필요한 곳의 클라이언트 경계와 경로·렌더러 수명의 작업 소유를 정한다. | 폴더 이름만으로 데이터 신뢰와 작업 수명을 정하지 않는다. 이 앱에 원본의 디렉터리와 승인 제도를 복제하지 않는다. |
| 실제 구현 | `app/(research)/layout.tsx`는 shell과 children을 반환하고 `research-route-shell.tsx`는 mount 뒤 bootstrap을 호출한다. `search-route-page.tsx`는 URL을 검증한 뒤 인증을 기다리는 결과 영역을 Suspense로 나눈다. 보호된 검색은 `ResolvedSearchRoute`가 사용자를 확인한 뒤 실행한다. | 먼저 보일 화면과 보호된 결과의 대기 경계를 구현에서 구분한다. 개인 학습 앱의 인증 방식이나 공개 범위를 이 사례로 정하지 않는다. |
| 수명 구현 | `app/components/research/ResearchBackgroundTasks.tsx`에는 unmount 정리와 현재 뷰 변경에 따른 AbortController 중단이 있다. shell의 bootstrap도 cleanup 때 중단하며 비활성 응답의 상태 갱신을 막는다. | 문제를 떠난 뒤 도착한 응답이 새 답을 덮지 않도록 작업 소유와 응답 적용 조건을 맞춘다는 가설로 옮긴다. 요청 취소가 서버의 이미 끝난 저장까지 취소한다는 뜻은 아니다. |
| 테스트 코드 | `app/(research)/__tests__/layout.test.tsx`는 shell·children이 보이고 서버 library 조회가 호출되지 않는지를 정적 렌더로 검사한다. [경로 수명 문서](https://github.com/jaeyoungkang/lighthouse/blob/df85ac9a6f09c569d0e01b83ebdca4eebc996ea5/docs/runtime-flows/research-route-lifecycle.md)는 URL 복원과 ephemeral view, 인증 bootstrap 실패를 구분한다. | 테스트가 있다는 사실만으로 운영 성공과 hydration을 입증하지 않는다. 원본의 제품 계획이 구현 위치·대기 범위·수명으로 이어진다는 근거로 읽었다. |

## 이 프로젝트에서 직접 확인한 사실

- `npm list next react react-dom --depth=0`의 설치 결과는 Next.js 16.4.3, React·React DOM 19.3.1이다.
  `package.json`은 OpenNext Cloudflare 1.20.13을 지정한다.
- `next.config.ts`는 `trailingSlash`와 옛 주소 이동을 설정하며 `cacheComponents`는 설정하지 않았다. 설치 패키지
  `node_modules/next/dist/server/config-shared.js:146`의 기본값은 `cacheComponents: false`다. 같은 모듈의
  `defaultConfig.cacheComponents`를 읽는 Node 명령도 `false`를 반환했다. 설정의 부재만으로 기본값을 추정하지 않았다.
- 설치 문서 `node_modules/next/dist/docs/01-app/03-api-reference/01-directives/use-cache.md`도 해당 플래그가 필요하다고
  명시한다. `node_modules/next/dist/docs/01-app/02-guides/caching-without-cache-components.md`는 기능을 끈 경우
  `fetch` 기본값이 캐시하지 않음이며 명시한 `force-cache`와 `unstable_cache`로 조회를 캐시할 수 있다고 설명한다.
- `app/[[...slug]]/page.tsx`는 `generateStaticParams`와 `dynamicParams = false`로 공개 콘텐츠 경로를 정한다.
  상호작용은 `SenseStage`, `Quiz`, `Ask`에 맡긴다. 해설은 `app/api/`의 Route Handler가 받는다.
- `README.md`는 `next dev`가 같은 Worker의 Durable Object를 실행하지 못하므로 API와 횟수 제한을 Workers
  미리보기에서 확인한다고 설명한다. 개인별 답·피드백·진도 저장과 이어 하기는 미구현이라고 밝힌다.

## 구현 검증에서 전달받은 관찰

주 에이전트가 전환을 검증하며 관찰한 결과다. 이번 조사에서 장애를 다시 재현하지 않았고, 강PD의 learn 기록으로 보지 않는다.

- 빌드 뒤 `run_worker_first`를 바꾼 상태에서는 HTML이 열려도 JavaScript·CSS가 404였고 컨트롤이 작동하지 않았다.
  설정을 반영해 다시 빌드한 뒤 해결했다. 빌드 결과와 정적 파일 경로가 같은 설정을 반영해야 한다는 적용 근거다. (잠정)
- `next dev`에서의 실패와 Workers 미리보기에서의 성공 여부는 기능이 쓰는 바인딩에 따라 다를 수 있다.
  이 조건을 모든 Next.js 프로젝트의 장애 원인으로 일반화하지 않는다. (잠정)

## 설계 판단과 사전부검

URL은 다시 열 위치, UI는 작성 중인 답, 서버는 저장을 확인한 기록을 소유하게 한다는 구분은 제안한 설계다. URL에 답을
실으면 주소 공유·기록에 답이 남을 수 있고, UI 상태를 영구 기록으로 취급하면 새로고침 후 사라질 수 있다. 어떤 값을 어디까지
복원해야 하는지는 구현할 기능의 요구와 맞춰야 한다. 아직 편리함이나 학습 효과를 검증하지 않았다.

이 모델이 틀리게 쓰일 가능성은 세 가지다. Server Component면 항상 정적이라고 읽는 것, 공식 문서의 기능을 Cloudflare가
모두 지원한다고 읽는 것, HTML이 열리면 hydration도 성공했다고 읽는 것이다. 모델은 각각 데이터의 결정 시점, 설치 버전과
어댑터의 조건, 실제 JavaScript 전달과 조작 결과를 별도로 보도록 했다. 캐시 키에 사용자 식별자를 넣는 일도 권한 검사를
대신하지 않는다. 캐시는 저장소나 중복 방지 장치로 해석하지 않는다.

서버 변경과 화면 갱신은 분리해 이해해야 하지만, 모든 변경에 `revalidatePath`가 필요한 것은 아니다. 실제로 어떤 조회를
캐시하는지에 따라 다시 읽기와 무효화 방법을 고른다. Server Action을 도입하는 것 자체가 개선이라는 결론도 내리지 않았다.
