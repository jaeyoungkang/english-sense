---
name: web-app-implementation
description: 승인한 웹앱 동작을 실제 실행 경로로 구현하고 실패 경로와 배포 런타임까지 확인하며, 정해진 계약대로 기능을 만들거나 버그·API·저장·외부 연동·배포 경계를 고칠 때 쓴다.
metadata:
  background: "web-app-production@8b7d72929a2d0e9e1792ad0347f17a9954a61208, web-app-ux-design@e7f063e92891004a6148257f0ed0037f7cc3f24a, web-app-architecture@8b7d72929a2d0e9e1792ad0347f17a9954a61208, nextjs-development@8b7d72929a2d0e9e1792ad0347f17a9954a61208, production@d0ef635740b10ce5901f26b8219bc7979d40e3b8"
---

# 웹앱 구현

승인한 동작을 구현하고 실제 결과와 연결하는 순서다. 제품 약속을 새로 정하는 일은 기획 스킬이 맡는다.
먼저 배경 모델과 `project.md`가 가리키는 현재 제품·구조·실행 문서를 읽는다.

## 순서

1. **바꿀 동작과 실제 경로를 맞춘다.** 승인한 수용 조건에서 입력·처리·상태·화면으로 이어지는 경로를 찾고,
   이번에 고칠 곳과 영향만 살펴볼 곳을 나눈다. `knowledge/domain/web-app-production.md` "규칙" 2·5와
   `knowledge/production.md` "규칙"의 "일을 시작할 때"를 따른다. 각 상태와 불변 조건의 담당 위치는
   `knowledge/domain/web-app-architecture.md` "규칙" 4·5·11로 판단한다.
2. **설계를 바꿀 가정이 남았는지 가른다.** `knowledge/domain/web-app-production.md` "규칙" 4에 해당하면
   대표 입력 하나로 그 경계를 통과하는 가장 얇은 기존 실행 경로를 고른다. 제품이 쓸 함수·처리기를 호출해 성공과
   주요 실패를 판정하고, 결과를 보고 넓은 구현의 방향을 정한다. 이미 확인한 가정이면 새 실행 도구를 만들지 않고
   그 근거를 사용한다.
3. **규칙과 상태의 담당 위치에서 구현한다.** 공유하는 뜻과 변환 경계를 먼저 맞추고 관련 호출부를 바꾼다.
   `knowledge/domain/web-app-architecture.md` "규칙" 1·10·11과 `knowledge/domain/nextjs-development.md`
   "규칙" 1~5로 실행 경계와 상태 수명을 판단한다. 현재 담당 위치로 충분한지 먼저 보고 필요한 경계만 만든다.
4. **실패와 상태 변경을 같은 경로에서 확인한다.** 입력·출력, 외부 호출과 저장 사이의 실패를
   `knowledge/domain/web-app-architecture.md` "규칙" 2·3·5·6·9로 고른다. 성공 결과뿐 아니라 거절한 요청이
   비용이나 상태 변경을 일으키는지도 실제 담당 함수를 통과해 확인한다. 변경한 경계를 덮는 기존 테스트부터 쓴다.
   결과 불명인 저장과 늦은 응답은 같은 구조 모델 "규칙" 6·13에서 정한 조회·재시도·채택 조건을 실제 경로로 확인한다.
5. **사용할 런타임에서 수용 조건을 실행한다.** `knowledge/domain/nextjs-development.md` "규칙" 8·9와
   `knowledge/domain/web-app-production.md` "규칙" 2·3·6에 따라 빌드 산출물, 자산 전달, 브라우저 조작과
   실제 처리 결과를 연결한다. 외부 호출과 배포는 현재 승인 범위에서 실행하고, 실행하지 못한 조건을 따로 남긴다.
   화면을 바꿨으면 `knowledge/domain/web-app-ux-design.md` "규칙" 3·6·7·8·9·10·11·12로 상태 안내·입력 보존·키보드·좁은 화면·재개와 이미지 실패·대화 맥락을 확인한다.
   반복 자료가 입력을 가리는지, 응답 대기 중 수행과 복원 뒤 순서, 과거를 읽는 중 응답 도착도 같은 규칙으로 확인한다.
   조작 가능한 시안도 실제 서버 저장이나 사람이 이해했다는 근거로 올리지 않는다.
6. **현재 흐름과 결과를 맞춘다.** 처리 순서·담당 위치·호환·실패 경로가 바뀌었으면 현재 구조 문서를 함께 고친다.
   수용 조건에 실행 방법·결과·미확인 범위를 연결하고, `knowledge/domain/web-app-production.md` "규칙" 6·7로
   확인한 기술 동작과 사람이 판단할 품질을 나눈다. 넘길 작업이 있으면 `knowledge/production.md` "규칙"의
   "넘길 때 작업 맥락과 그 일의 스킬·배경 모델, 멈춤 규칙을 함께 넘긴다"를 따른다.

이 프로젝트에 맞춘 경로·명령·검토 사례는 `project.md`에 있다. Lighthouse에서 가져온 부분과 확인 범위는
`references/lighthouse.md`에 있다.
