# 영어 감각 진행 상태판

이 이슈는 현재 상태를 정본 문서에 연결한다. 제품 약속은 docs/learning-service.md, 제작 판단은 제작·UX·아키텍처·Next.js 모델이 소유한다.

## 목적과 승인 범위

강PD의 개인 영어 감각·책 장면 학습을 웹에서 편리하게 이어 간다. 상단의 표현 감각 자료를 참고하며 문제·내 수행·AI 대화가 하나의 흐름에 쌓이게 한다. Next.js·Cloudflare와 project-base 기반을 사용한다.
2026-10-26 제작·아키텍처·Next.js·UX 모델을 준비하고 앱 디자인을 처음부터 다시 하도록 정했다. Lighthouse의 계약 설계부터 엔지니어링 방법까지 상세히 참고한다.

## 현재 사실

| 항목 | 현재 상태 | 정본 |
| --- | --- | --- |
| 제품 요구 | 장면, 수행 차이, 먼저 풀기, 다시 꺼내기, 이어 하기, AI와 실제 수행 구분의 여섯 약속을 승인했다 | docs/learning-service.md |
| 전환본 | Next.js·React·OpenNext·Cloudflare Workers로 기존 페이지·퀴즈·해설 API를 이관했다 | README.md, docs/architecture.md |
| 운영 배포 | https://english.artificialmind.kr/ 와 기존 API 도메인이 같은 Worker에서 실행된다. 별도 확인 주소는 https://english-sense.jaeyoung2010.workers.dev | docs/cloudflare-migration.md |
| 검증 | 타입·단위 51개·로컬 Workers 브라우저 30개·운영 작업 공간 20개가 통과했다. 선택형 2번·쓰기형 6번의 실제 AI 응답과 새로고침 뒤 실제 호출 두 번 유지를 별도로 확인했다 | docs/tasks/quiz-artifacts.md |
| 모델 | UX·구조 모델을 먼저 갱신하고 구현했다. 상태·귀속·복원에 관한 실행 예측이 이번 반례 검사에서 지지됐다. 사람의 해석은 미확인이다. 구현 누락 두 건은 독립 검토로 찾아 수정했다. 개발 향상·사용성·학습 효과는 미확인이다 | knowledge/domain/web-app-production.md, web-app-architecture.md, nextjs-development.md, web-app-ux-design.md |
| 새 디자인 | 상단 have 자료 아래에 기존 일곱 퀴즈 카드를 추가한다. 카드별 최초 답·수정·질답·초안을 보존하고 질문 대상을 표시한다. 전체 순서와 v1/v2 원본을 보존해 v3로 이관한다. 강PD의 사용성·선호는 미확인이다 | docs/ux-design.md, docs/tasks/quiz-artifacts.md, components/learning-workspace.tsx |
| 스킬 | project-base 스킬 넷과 Lighthouse에서 차용한 기획·구현 스킬 둘이 있다. 새 스킬의 개발 효과는 미확인이다 | .claude/skills/, knowledge/skill-routing.md |
| 평가기 | 경보 2, 낡은 이음 0/18(0%). 골격 어김·깨진 참조·배경 어긋남·순환은 0이다. 경보 후보의 사람 판정은 하지 않았다 | knowledge/domain/knowledge-quality.md, scripts/knowledge-quality.py |
| 원문 | Lighthouse df85ac9a6f09c569d0e01b83ebdca4eebc996ea5의 계약→코드→검사를 추적하고 원문 불일치·mock의 범위도 구분했다. W3C·GOV.UK UX 자료를 조사했다. 원본 테스트는 실행하지 않았다 | docs/research/lighthouse-contract-engineering.md, docs/research/web-app-ux-design.md |
| 아직 없는 기능 | 개인 계정·서버 기록 DB·다른 기기 복원·기존 기록 연결. 현재 수행·대화는 같은 브라우저에만 임시 보관한다 | docs/learning-service.md |

## 현재 작업

- [#3 Next.js와 Cloudflare 전환·프로젝트 기반 구성](https://github.com/jaeyoungkang/english-sense/issues/3)은 완료했다. 운영 주소·기존 API 도메인의 전환과 실제 동작을 확인하고, 세 모델과 두 차용 스킬을 구성했다.
- [#4 개인 영어 학습의 수행·기록·이어 하기](https://github.com/jaeyoungkang/english-sense/issues/4)가 남아 있다. 퀴즈 아티팩트·문항별 실제 대화와 모형 예측 검사를 운영에 반영했다. 개인 서버 기록·인증·다른 기기 재개를 구현하고 강PD의 사용으로 디자인을 검토한다. 사용 편의와 학습 효과는 강PD가 사용한 뒤 판단한다.

## 베이스 동기화

- 베이스: project-base
- 씨앗 파일의 판: abec83e02269a2460d1ac459bda213c338942d2f (2026-10-26). 각 모델·스킬의 원본 판은 picked_from, 배경 모델 판은 background에 있다.
- 받은 씨앗: 공통 모델 9개, 스킬 4개와 템플릿 기반 파일. event-tracking·event-log·user-identity는 고르지 않았다.
- Lighthouse 기법은 강PD가 직접 차용하도록 지시한 별도 자료다. 원본 스킬을 그대로 받은 사본으로 표시하지 않고 출처와 바꾼 범위를 각 참고 기록에 남겼다.
- 새 제작 모델·스킬은 이 프로젝트의 초기 적용판이다. 공용 베이스에 옮길 효과와 적용 범위는 실제 개발에 사용하며 확인한다.
- abec83e까지 씨앗 변경을 검토해 받았다. 진단 절차를 knowledge-diagnosis로 옮긴 변경과 한국어 모델·참고 자료·라우팅을 맞췄다. 평가기 공식 테스트 21개가 통과했다.
- 후속 upstream 9d1a055까지의 변경이 있다. 이번 퀴즈 구현에 씨앗 개편을 섞지 않았으며 abec 이후 변경은 다음 동기화에서 검토한다. UX 변경은 사용자 결정과 초기 적용 범위여서 보편 효과를 베이스 기여로 제안하지 않았다.

## 다음 행동

운영 학습 작업 공간을 사용해 디자인과 대화 흐름을 검토하고, 개인 서버 저장·인증·다른 기기 복원을 구현한다. 현재 근거와 모델 판단은 docs/tasks/quiz-artifacts.md, 남은 범위는 #4에서 이어 간다.
