# Next.js와 Cloudflare 전환

2026-10-26 강PD가 Next.js 기반, Cloudflare 서비스 운영, project-base 템플릿 구성을 지시했다.
작업은 [전환 이슈](https://github.com/jaeyoungkang/english-sense/issues/3)에서 이어 간다.

## 구성과 이유

공개 콘텐츠와 해설기를 한 Next.js 앱에 두고 OpenNext로 Cloudflare Workers에서 실행한다.
이후 문제 풀이와 학습 상태 기능을 같은 앱에서 확장할 수 있도록 기존 JavaScript 상호작용을 React 컴포넌트로 옮겼다.
학습 내용과 공개 URL은 유지한다. Python 정적 생성기, GitHub Pages와 원격 FastAPI 서버를 쓰던 실행 경로는 전환 대상이다.

공개 페이지는 정적으로 만들고, Claude 요청은 동적 API 경로에서 처리한다. `worker.ts`가 OpenNext 요청 처리기를
이용하면서 요청 횟수를 관리하는 `DailyQuota` Durable Object도 내보낸다. 일일 한도를 메모리에만 두면 실행 인스턴스마다
횟수가 달라지므로 SQLite 저장소로 옮겼다. 학습 기록을 저장하는 데이터베이스는 이번 범위에 없다.

`project-base` 씨앗의 기준은 `99111d9b0c5e77e7350fa6485bfdbf50ae81da8e`다.
모델 9개, 스킬 3개와 그 밖의 씨앗 파일을 받았고, 선택 항목인 사용자 행동 기록 모델은 받지 않았다.
각 사본의 `picked_from`과 상태판에서 판을 확인한다.

## 운영 전환 순서

1. 타입·API·브라우저 검사와 OpenNext 빌드를 마친다.
2. `english-sense` Worker에 코드를 올리고, 기존 운영 키를 Worker secret으로 옮긴다. 키를 파일이나 출력에 남기지 않는다.
3. Workers 주소에서 페이지와 실제 해설을 확인한다.
4. `english.artificialmind.kr`의 Custom Domain을 같은 Worker로 연결한다. 기존 GitHub Pages CNAME을 교체한다.
5. 공개 주소에서 페이지, 옛 주소의 이동, 사이트맵, 해설과 오류 응답을 확인한다.
6. GitHub Pages 게시를 해제해 두 배포 경로가 어긋나지 않게 한다. 원격 서버는 회복에 쓸 수 있도록 전환 확인 뒤 정리 여부를 판단한다.

기존 별도 API 도메인을 유지한다면 같은 Worker에 연결하고 옛 API 경로를 지원해야 한다.
신규 화면은 해당 도메인에 의존하지 않는다. Workers 도메인을 먼저 검증한 뒤 기존 운영 도메인을 바꾼다.

## 검증 상태

2026-10-26 전환을 확인했다.

- Next.js·OpenNext 빌드와 타입·API·한도·호환 단위 검사 22개가 통과했다.
- 기존 페이지 12개, 문제 30개와 쓰임 전환 26개를 이관 자료와 대조했다.
- PC·모바일 브라우저 검사 10개가 로컬 Workers, workers.dev 주소, 운영 도메인에서 각각 통과했다.
- 실제 브라우저에서 신규 API의 해설·변환, 두 도메인의 준비 상태와 기존 API 주소의 해설 200 응답을 확인했다.
- 두 운영 호스트를 english-sense Worker의 Custom Domain으로 연결했다. 기존 CNAME 두 개만 교체했고 구글 소유 확인 TXT는 보존했다.
- 기존 CNAME 충돌(100117)은 DNS 편집 권한이 있는 기존 Cloudflare MCP 연결로 처리했다. Wrangler 인증만으로 해결했다고 기록하지 않는다.
- GitHub Pages 게시를 해제했다. 이전 원격 API 서버는 복구용으로 남아 있으며 현재 두 호스트의 요청 경로에는 들어가지 않는다.

개인 학습 기록·인증·이어 하기·질답 저장을 포함한 새 흐름은 아직 구현하지 않았다. 이번 결과는 기존 기능과 제작 기반의 이전이다.

## 참고한 공식 문서

- [Cloudflare의 OpenNext 어댑터 안내](https://developers.cloudflare.com/workers/framework-guides/web-apps/opennext/)
- [OpenNext 설정](https://opennext.js.org/cloudflare/get-started)
- [커스텀 Worker와 Durable Object 내보내기](https://opennext.js.org/cloudflare/howtos/custom-worker)
- [Cloudflare Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
