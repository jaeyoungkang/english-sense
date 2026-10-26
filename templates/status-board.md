# 영어 감각 진행 상태판

이 이슈는 현재 상태를 정본 문서에 연결한다. 제품 약속은 docs/learning-service.md, 제작 판단은 세 도메인 모델이 소유한다.

## 목적과 승인 범위

강PD의 개인 영어 감각·책 장면 학습을 웹에서 편리하게 이어 간다. Next.js·Cloudflare와 project-base 기반을 사용한다.
2026-10-26 웹앱 제작·웹앱 아키텍처·Next.js 개발 모델을 나누고 Lighthouse 기획·구현 기법을 모델과 스킬로 차용하도록 정했다.

## 현재 사실

| 항목 | 현재 상태 | 정본 |
| --- | --- | --- |
| 제품 요구 | 장면, 수행 차이, 먼저 풀기, 다시 꺼내기, 이어 하기, AI와 실제 수행 구분의 여섯 약속을 승인했다 | docs/learning-service.md |
| 전환본 | Next.js·React·OpenNext·Cloudflare Workers로 기존 페이지·퀴즈·해설 API를 이관했다 | README.md, docs/architecture.md |
| 운영 배포 | https://english.artificialmind.kr/ 와 기존 API 도메인이 같은 Worker에서 실행된다. 별도 확인 주소는 https://english-sense.jaeyoung2010.workers.dev | docs/cloudflare-migration.md |
| 검증 | API·한도·호환 단위 검사 22개, PC·모바일 브라우저 검사 10개가 로컬·Workers 확인 주소·운영 주소에서 각각 통과했다. 신규 해설·변환과 기존 API 주소의 실제 해설 응답도 확인했다 | docs/tasks/webapp-foundation.md |
| 모델 | 제작, 아키텍처, Next.js 개발의 세 모델을 만들고 교차 검토했다 | knowledge/domain/web-app-production.md, web-app-architecture.md, nextjs-development.md |
| 스킬 | project-base 스킬 셋과 Lighthouse에서 차용한 기획·구현 스킬 둘이 있다. 새 스킬의 개발 효과는 미확인이다 | .claude/skills/, knowledge/skill-routing.md |
| 원문 | Lighthouse df85ac9a6f09c569d0e01b83ebdca4eebc996ea5를 읽었으며 원본 테스트를 실행하거나 원본 파일을 고치지 않았다 | docs/research/lighthouse-methods.md |
| 아직 없는 기능 | 개인 학습 기록 DB·인증·질답 저장·복원을 포함한 새 개인 학습 흐름 | docs/learning-service.md |

## 현재 작업

- [#3 Next.js와 Cloudflare 전환·프로젝트 기반 구성](https://github.com/jaeyoungkang/english-sense/issues/3)은 완료했다. 운영 주소·기존 API 도메인의 전환과 실제 동작을 확인하고, 세 모델과 두 차용 스킬을 구성했다.
- [#4 개인 영어 학습의 수행·기록·이어 하기](https://github.com/jaeyoungkang/english-sense/issues/4)가 남아 있다. 상태·기록·권한·실패 수용 조건을 기획 스킬로 구체화한다. 사용 편의와 학습 효과는 강PD가 사용한 뒤 판단한다.

## 베이스 동기화

- 베이스: project-base
- 씨앗 파일의 판: 99111d9b0c5e77e7350fa6485bfdbf50ae81da8e (2026-10-26). 각 모델·스킬의 원본 판은 picked_from, 배경 모델 판은 background에 있다.
- 받은 씨앗: 공통 모델 9개, 스킬 3개와 템플릿 기반 파일. event-tracking·event-log·user-identity는 고르지 않았다.
- Lighthouse 기법은 강PD가 직접 차용하도록 지시한 별도 자료다. 원본 스킬을 그대로 받은 사본으로 표시하지 않고 출처와 바꾼 범위를 각 참고 기록에 남겼다.
- 새 제작 모델·스킬은 이 프로젝트의 초기 적용판이다. 공용 베이스에 옮길 효과와 적용 범위는 실제 개발에 사용하며 확인한다.

## 다음 행동

승인된 개인 학습 요구를 실제 사용자 과업으로 구체화하고 새 학습 흐름을 구현한다. 절차와 완료 근거는 docs/tasks/webapp-foundation.md와 두 웹앱 스킬에서 이어 간다.
