# 영어 감각 (english-sense)

강PD가 방향을 정하고 판단한다. 이 파일에는 목적, 늘 지킬 규칙, 상황별로 읽을 문서만 적는다.

## 목적

모든 판단은 목적에 비추어 한다. 목적은 강PD가 정하고, 바꿀 때도 강PD가 정한다.

- **무엇을 왜 하는가:** 강PD가 터미널에서 진행하던 영어 감각·책 장면 학습을 웹에서 편리하게 이어 가도록 만든다. 강PD의 개인 학습부터 완성하며, 기본동사의 감각 설명, 원서 장면 연습, AI 해설을 바탕으로 서비스를 고도화한다.
- **성공 기준:** 강PD가 웹에서 감각 설명을 읽고, 장면 문제를 풀고, AI 해설을 받을 수 있는지 실제 흐름으로 확인한다. 편리해졌는지는 강PD가 사용한 뒤 판단한다.
- **하지 않는 것:** 학습 모델과 학습 기록의 정본을 중복해서 관리하지 않는다. 그 정본은 study-and-learn 프로젝트에 있다.

## 철학

1. **지식은 대상을 이해한 것이고, 스킬은 그 이해를 배경에 두고 일을 해내는 능력이다.** 모델은 알기 위해서가 아니라 일을 잘 해내려고 구축한다. 그래서 모델의 쓸모는 그 모델을 배경에 둔 일이 나아지는지로 본다. 모델은 `knowledge/model.md`, 스킬과 모델의 관계는 `knowledge/skills.md`에 있다.
2. **기억할 것은 파일과 이슈에 적는다.** 문서에는 기록을 쌓지 않고 모델을 담는다. 배운 것은 모아 두었다가, 쌓이면 모델을 다시 짜서 대상을 더 잘 설명하게 만든다. 덧붙이지 않는다.
3. **프로젝트를 진행하는 것은 그 분야의 지식 체계를 구축해 가는 일이다.** 얼마나 잘 만드는지는 그 분야를 얼마나 이해하는지에 달려 있고, 이해는 철학 2대로 적어야 프로젝트의 지식이 되고, 적지 않은 이해는 그것을 가진 사람이나 세션과 함께 사라진다. 보편 지식은 이 프로젝트의 지식 체계를 대신하지 못한다. 근거는 `knowledge/model.md` "지식 체계"에 있다.
4. **강PD가 방향을 정하고 판단한다.** 에이전트는 조사하고 제안하며, 강PD가 정한 범위 안에서 만든다.
5. **작은 일은 가볍게 하고, 위험한 일은 신중하게 한다.** 되돌리기 어렵거나 외부에 공개되는 일일수록 확인을 늘린다.
6. **직접 확인한 일만 완료로 본다.** 에이전트의 보고는 근거일 뿐 승인이 아니다.

## 늘 지킬 규칙

- 독립적으로 진행할 수 있고 병렬 처리가 유용한 작업은 필요에 따라 하위 에이전트에 위임한다. 모델, 추론 강도와 동시 실행 수는 세션의 글로벌 기본 설정을 따르며 별도로 지정하지 않는다.
- push, merge, PR, 배포, 게시처럼 외부로 나가는 행동은 강PD가 승인한 범위 안에서만 한다.
- 강PD에게 하는 말은 한국어 어법에 맞게 '합니다'체로 쓰되, '께서', '말씀', '여쭙니다' 같은 극존칭은 쓰지 않는다. 문서는 `.claude/skills/korean-prose/SKILL.md`를 따르고, 개념과 말은 `knowledge/concepts.md`를 따른다.
- 커밋은 강PD의 개인 계정(`jaeyoungkang`, `jaeyoung2010@gmail.com`)으로 한다. 커밋하기 전에 `git config user.email`을 확인한다.
- 호스트의 로컬 메모리(Claude Code auto memory)는 읽지도 쓰지도 않는다. `.claude/settings.json`이 이를 끈다.
- 비밀 정보와 인증 정보는 기록하지도 출력하지도 않는다. API 키 같은 값은 추적하지 않는 로컬 환경 파일이나 Cloudflare Worker secrets에만 두고 커밋하지 않는다.

## 상황별로 읽을 문서

| 상황 | 읽을 문서 |
| --- | --- |
| 일을 시작하거나 마친다. 결과가 기대와 다르다. 검사나 스킬을 더하거나 걷어 낸다 | `knowledge/production.md` |
| 모델을 만들거나 키운다 | `knowledge/model.md`. 한 분야의 모델은 `knowledge/domain/`에 있다 |
| 새로 배운 것을 모델에 반영한다. 모델의 관계나 규칙을 다시 짠다 | `.claude/skills/model-update/SKILL.md` |
| 한국어 문서·이슈·댓글·커밋을 새로 쓰거나 어법에 맞게 고쳐 쓴다. 오탈자처럼 한 군데만 고치는 일은 해당하지 않는다. 다른 스킬의 절차로 이런 글을 쓸 때도 그 스킬과 함께 부른다 | `.claude/skills/korean-prose/SKILL.md`. 모델은 `knowledge/domain/korean-writing.md`, `knowledge/domain/document-format.md` |
| 문서에서 쓰는 말의 뜻을 확인하거나 새 개념을 더한다 | `knowledge/concepts.md` |
| `AGENTS.md`나 `CLAUDE.md`를 만들거나 고친다 | `knowledge/agents-md.md` |
| 스킬을 만들거나 고친다 | `knowledge/skills.md` |
| 영어 학습 화면이나 서비스의 범위를 정한다 | `docs/learning-service.md`. 학습 자료의 정본은 study-and-learn 프로젝트에 있다 |
| 웹앱 기능을 기획하거나 사용자에게 보이는 행동을 바꾸기 전에 작업 계약을 만든다 | `.claude/skills/web-app-planning/SKILL.md`와 머리표의 배경 모델. 이미 승인한 범위는 다시 묻지 않는다 |
| 승인한 웹 기능을 구현·수정하거나 API·저장·외부 연동·배포 경계를 바꾼다 | `.claude/skills/web-app-implementation/SKILL.md`와 머리표의 배경 모델 |
| 웹앱에서 사용자 과업과 품질·완료 근거를 판단한다 | `knowledge/domain/web-app-production.md` |
| 앱의 정보구조·사용자 흐름·화면·시각 체계를 설계하거나 처음부터 다시 만든다 | `knowledge/domain/web-app-ux-design.md`, `docs/ux-design.md`와 `.claude/skills/web-app-planning/SKILL.md`. 현재 학습 작업 공간의 검증은 `docs/tasks/learning-workspace.md`, 이전 시안은 `docs/tasks/ux-redesign.md`에서 읽는다 |
| 책임·상태·데이터·API·권한·실패의 경계를 설계하거나 바꾼다 | `knowledge/domain/web-app-architecture.md`. 실제 구조는 `docs/architecture.md` |
| Next.js의 경로·컴포넌트·렌더링·데이터 변경·캐시를 고른다 | `knowledge/domain/nextjs-development.md`. 설치 버전과 설정을 함께 확인한다 |
| Next.js 실행, Cloudflare 배포, 환경 설정을 바꾼다 | `README.md`. 실제 설정과 명령을 함께 확인한다 |
| 상태판 본문을 쓴다 | `templates/status-board.md` |
| 세션을 시작한다. 베이스에 있는 모델이나 스킬이 필요하다. 모델이나 스킬을 만들거나 고쳤다 | `.claude/skills/base-sync/SKILL.md` |
| 지식 체계(모델과 모델 사이의 이음)와 그것을 배경에 둔 스킬의 품질을 진단한다. 기반을 점검하거나, 베이스와 동기화한 뒤 어디부터 다시 볼지 정한다 | `.claude/skills/knowledge-diagnosis/SKILL.md`. 모델은 `knowledge/domain/knowledge-quality.md` |

프로젝트의 문서와 스킬이 늘면 이 표에 행을 더한다. 행은 읽으면 행동이 달라지는 문서만 가리킨다.

## 상태판

[영어 감각 진행 상태판](https://github.com/jaeyoungkang/english-sense/issues/2) 이슈가 현재 상태를 담는다. 판단과 완료 기준은 문서에 있고, 상태판은 그 문서를 연결할 뿐이다. 상태판은 제목이 "진행 상태판"으로 끝나는 열린 이슈다. 새 저장소에서는 #1이지만 저장소마다 다를 수 있어, 번호는 제목으로 찾는다(`gh issue list --search '"진행 상태판" in:title'`). 아래 `2`는 그 번호다.

- 세션을 시작하면 먼저 상태판을 읽고(`gh issue view 2`), base-sync 스킬로 베이스와 동기화한 뒤, 하던 일과 현재 상태를 강PD에게 짧게 브리핑한다. 베이스가 없는 저장소(project-base 자신)는 동기화하지 않는다.
- `main`에 push할 때 상태판 본문을 현재 상태에 맞게 고쳐 쓴다. 순서는 commit, 상태판 갱신, push다. 댓글을 달지 않고 `gh issue edit 2 --body-file <파일>`로 본문을 고친다. 끝낸 일은 줄이고 열려 있는 일을 현재 상태에 맞춘다. 상태판에도 기록이 아니라 모델을 담는다.
- `.githooks/pre-push`가 push할 때 상태판이 마지막 커밋보다 오래됐으면 알린다. 이 알림은 push를 막지 않는다. 막는 확인 명령을 정한 프로젝트는 그것이 실패하면 push를 막는다(`knowledge/production.md`, 잠정). 저장소를 새로 받으면 `git config core.hooksPath .githooks`를 한 번 실행한다.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
