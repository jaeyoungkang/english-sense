---
id: concepts
picked_from: "project-base:concepts@99111d9b0c5e77e7350fa6485bfdbf50ae81da8e"
kind: primitive
---

# 개념 사전

이 프로젝트의 문서·이슈·작업 지시서가 쓰는 개념이다. 같은 뜻에는 같은 말을 쓴다. 새 개념이 필요하면 먼저 여기에
더하고, 뜻이 겹치는 것이 생기면 하나로 합친다. 영어는 외부 문서에서 대응하는 표현을 찾을 때 쓴다. 이 프로젝트의
분야에만 있는 개념은 도메인 모델 문서에 적고, 여러 문서가 쓰게 되면 여기로 올린다.

지식, 스킬, 모델의 정의는 `AGENTS.md`의 철학 1이 선언한다. 아래 개념들은 모두 그 정의에서 출발한다. 모델과 기록은
`knowledge/model.md`, 스킬과 모델의 관계는 `knowledge/skills.md`가 풀어 쓴다.

## 개념

| 개념 | 영어 | 뜻 | 정한 곳 |
| --- | --- | --- | --- |
| 프로덕트 | product | 프로젝트가 만들어 세상에 내놓는 것. 사람들이 직접 쓰거나 보는 것이다 | `knowledge/production.md` |
| 배운 것 | learning | 아직 체계가 서지 않은 앎. 날짜, 출처, 배운 조건과 확인 단계를 붙여 모델 쪽에 모아 두고, 쌓이면 모델로 다시 짠다 | `knowledge/model.md` |
| 작업 맥락 | work context | 저장소를 다 읽어도 알 수 없어서, 전해 주지 않으면 다음 세션이 모르는 것. 강PD의 판단과 그 까닭, 아직 적히지 않은 결과다. 축은 지금의 물음, 위치, 걸어 둔 기대와 지난 결과, 강PD가 정한 것과 미룬 것이다. 일상의 '맥락'(배운 조건, 일의 동기)과 구별한다 | `knowledge/production.md` |
| 지금의 물음 | current question | 목적에 비춰 지금 답하려는 물음. 강PD가 정한다. 일의 단위이고, 다른 일은 이 물음에 답하거나 미룬다 | `knowledge/production.md` |
| 기대 | expectation | 변경 하나가 무엇을 낳아야 하는지. 무엇을 보면 맞았다고 하고 무엇을 보면 틀렸다고 할지를 바꾸기 전에 적는다 | `knowledge/production.md` |
| 소감 | user report | 프로덕트를 써 본 사람이 말한 느낌과 본 일. 걸어 둔 기대에 대한 결과로 읽는다 | `knowledge/production.md` |
| 지식 | knowledge | 대상을 이해한 것 | `AGENTS.md` |
| 모델 | model | 지식을 개념·관계·규칙으로 적어, 어떤 대상이 어떻게 돌아가는지 설명하는 것. 알기 위해서가 아니라 일을 잘 해내려고 구축하고, 쓸모는 그 모델을 배경에 둔 일이 나아지는지로 본다 | `knowledge/model.md` |
| 배경 모델 | background model | 한 일이나 스킬이 기대는 모델. 스킬은 머리표에 밝힌다 | `knowledge/skills.md` |
| 기록 | record | 있었던 일을 그대로 남긴 것. 모델을 고치는 자료가 된다 | `knowledge/model.md` |
| 지식 체계 | body of knowledge | 프로젝트가 한 분야를 이해한 것을 적은 것. 모델들과 모델 사이의 이음으로 이룬다. 스킬은 지식 체계에 들지 않고, 지식 체계를 배경에 두고 일을 해내는 능력으로 따로 둔다 | `knowledge/model.md` |
| 기반 | foundation | 강PD와 에이전트가 프로덕트를 개발할 때 기대는 것. 지식 체계(모델과 이음)에 스킬과 검사를 더한 것이다 | `knowledge/production.md` |
| 보편 지식 | general knowledge | 여러 대상에 두루 맞아 어느 한 대상에 대해 구체적으로 말하지 못하는 지식. 프로젝트의 지식 체계를 대신하지 못한다 | `knowledge/model.md` |
| 지식 전수 | knowledge transfer | 프로젝트가 쌓은 이해가 사람과 세션을 넘어 이어지는 일. 문서로 적혀야 이어지고, 적히지 않은 이해는 끊긴다 | `knowledge/model.md` |
| 모델 라이브러리 | model library | 베이스가 하는 구실. 다른 프로젝트에도 쓰이는 것으로 드러난 모델이 모이고, 프로젝트가 필요한 것을 골라 간다 | `knowledge/model.md` |
| 강PD | producer | 이 프로젝트를 책임지고 결정하는 사람. 방향을 정하고 판단하며 승인한다 | `AGENTS.md` |
| 정본 | source of truth | 판단과 완료 기준을 소유하는 저장소 파일. 이슈는 정본이 아니다 | `AGENTS.md` |
| 이슈 | issue | GitHub 이슈. 작업 지시를 남기거나 상태를 두거나 보고를 받는 자리 | `AGENTS.md` |
| 상태판 | status board | 프로젝트의 현재 상태를 정본에 연결해 보여 주는 이슈. 판단과 완료 기준을 새로 적지 않는다 | `AGENTS.md` |
| 호스트 | host | 에이전트를 실행하는 도구. Claude Code, Codex 같은 것이다 | `knowledge/skills.md` |
| LLM | LLM | 에이전트를 움직이는 언어 모델. 지식인 "모델"과 구별한다 | `knowledge/concepts.md` |
| 세션 | session | 호스트를 한 번 연 것 | `knowledge/concepts.md` |
| 스킬 | skill | 모델을 배경에 두고 한 종류의 일을 해내는 능력. 모델의 한 종류가 아니다. 그 일을 어떤 순서로 하고 어디서 무엇을 정하는지를 `shared-skills/`에 담아, 호스트가 그 일이 나타날 때 불러 쓰게 한다 | `knowledge/skills.md` |
| 상시 파일 | always-loaded file | 세션마다 자동으로 로드되는 파일. `AGENTS.md`, `CLAUDE.md` | `knowledge/agents-md.md` |
| 라우팅 표 | routing table | `AGENTS.md`의 "상황별로 읽을 문서" 표. 상황에 맞는 문서를 가리킨다 | `knowledge/agents-md.md` |
| 도메인 모델 | domain model | 한 분야가 어떻게 돌아가는지 설명하는 모델. 개념·관계·규칙·한계와 출처로 쓴다. `knowledge/domain/`이 담는다 | `knowledge/model.md` |
| 원시 모델 | primitive model | 다른 모델을 재료로 삼지 않고 자기 대상을 혼자 설명하는 모델(자체 완결성). 개념 사전과 바깥 개념은 공용어로 빌려 쓴다 | `knowledge/model.md` |
| 접목 모델 | grafted model | 다른 모델(원시 또는 접목)을 재료로 가리키고, 재료를 어떻게 맞물렸는지와 창발한 것을 자기 것으로 적는 모델 | `knowledge/model.md` |
| 창발 | emergence | 재료 어디에도 없다가 접목해서 새로 생긴 개념·관계·규칙 | `knowledge/model.md` |
| 베이스 프로젝트 | upstream | 모델과 스킬이 모여 있고, 프로젝트가 필요한 것을 골라 가는 저장소. 골라 간 사본은 그 프로젝트의 정본이다. project-base는 모든 프로젝트의 베이스이고, 새 프로젝트는 베이스에서 만든다 | `knowledge/library.md` |
| 동기화 | sync | 프로젝트가 세션을 시작할 때, 고른 모델마다 라이브러리에서 바뀐 것을 검토해 받을지 정하는 일. 받는 책임은 각 프로젝트가 진다 | `knowledge/library.md` |
| 기여 | contribution | 프로젝트가 다른 프로젝트에도 쓰일 배움을 베이스에 이슈로 제안하는 일. 받을지는 베이스가 정한다 | `knowledge/library.md` |
| 씨앗 | seed | 프로젝트를 시작할 때 베이스에서 받는 것. 늘 지킬 규칙과 모든 프로젝트가 밟는 절차의 스킬과 그 배경 모델, 템플릿의 스크립트와 훅이 읽거나 강제하는 모델, 씨앗 모델의 재료, 그리고 머리표가 없는 씨앗 파일이다. 그 밖의 모델과 스킬은 필요할 때 고른다 | `knowledge/library.md` |
| 고른 모델 | picked model | 라이브러리에서 골라 와서 저장소에 둔 모델이나 스킬의 사본. 머리표의 `picked_from`이 어느 라이브러리의 어느 모델을 어느 판에서 골랐는지 말한다. 사본은 그 프로젝트의 정본이고, 접목의 재료가 될 수 있다 | `knowledge/library.md` |
| 판 | version | 사본이 갈라져 나온 원본의 커밋(`<id>@<커밋>`). 원본의 어느 시점까지 검토했는지를 말한다. 접목 모델의 재료, 스킬의 배경 모델, 고른 모델의 원본이 모두 이 꼴로 적는다 | `knowledge/model.md` |
| 확인 단계 | verification stage | 배운 것에 다는 단계. 한 맥락에서 겪고 돌려 본 것은 잠정, 다른 맥락에서도 확인되면 확인이다. 입증된 범위를 뜻하며 확신의 크기가 아니다 | `knowledge/model.md` |
| 비대 | bloat | 모델 하나가 한 대상보다 많은 것을 설명하는 상태. 줄 수가 아니라 담은 대상의 수로 본다 | `knowledge/model.md` |
| 사전부검 | premortem | 받기 전에 "이 배움이 틀렸다면 이유는 무엇인가"를 묻는 일 | `knowledge/model.md` |
