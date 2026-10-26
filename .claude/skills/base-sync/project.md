# base-sync — 이 프로젝트에 맞춘 것

- 베이스: project-base([jaeyoungkang/project-base](https://github.com/jaeyoungkang/project-base)). `picked_from`의 저장소 자리에는
  `project-base`를 적는다. 단 이 저장소가 project-base 자신이면 베이스가 없으니 고르지도 동기화하지도 않는다.
- 고른 모델의 판은 사본의 머리표 `picked_from`에 있다. 씨앗 파일의 판은 상태판(번호는 `AGENTS.md`의 상태판 절)의 "베이스 동기화"
  절에 둔다.
- 최근 동기화 판: `abec83e02269a2460d1ac459bda213c338942d2f` (2026-10-26). 씨앗 모델 9개와 스킬 4개의 변경을 검토해 받았다.
- 이 사본은 english-sense 프로젝트의 정본이다. 상태판은 `AGENTS.md`에 연결한 열린 진행 상태판 이슈를 쓴다.
- 베이스 받아 오기: `gh repo clone jaeyoungkang/project-base .git/base-sync/project-base`. 폴더 이름이 저장소 이름이어야 평가기가
  `picked_from`의 저장소를 찾는다. 다 쓰면 `.git/base-sync/`를 지운다. 베이스 작업 트리의 파일은 직접 고치지 않는다.
- 고른 모델의 밀린 변경 보기: `python3 scripts/knowledge-quality.py . .git/base-sync/project-base`의 "고른 모델의 밀린 변경" 표.
  변경은 `git -C .git/base-sync/project-base diff <판> HEAD -- <경로>`로 읽는다.
- 씨앗 파일의 변경 보기: `git -C .git/base-sync/project-base log --oneline <씨앗 판>..HEAD -- AGENTS.md CLAUDE.md templates .githooks scripts .claude/settings.json knowledge/skill-routing.md`.
- 베이스의 현재 커밋: `git -C .git/base-sync/project-base rev-parse --short HEAD`.
- 기여 이슈: `gh issue create --repo jaeyoungkang/project-base`.
- 기여를 처리할 때 볼 지식 지도: 기여한 저장소를 받아 `python3 scripts/knowledge-quality.py --map <기여한 저장소> .`.

## project-base에서 씨앗과 고르는 것

project-base로 시작한 프로젝트가 무엇을 씨앗으로 받고 무엇을 고르는지다. 기준은 `knowledge/library.md` 규칙 1, 2이고, 갈래는
2026-10-25 강PD가 정했다(#20). 2026-10-26 씨앗 기준을 바꾼 뒤(#25)에도 갈래는 같다. 평가기는 이 표로 고른 사본을 씨앗과 고른 것으로
가르고(`python3 scripts/knowledge-quality.py --map`), 이 저장소 안에서 고르기로 적힌 노드는 고립으로 세지 않는다. 모델이나 스킬을
더하거나 배경을 바꾸면 이 표도 맞춘다.

| 갈래 | 모델 | 스킬 | 까닭 |
| --- | --- | --- | --- |
| 씨앗 | model, production, skills, agents-md, library, concepts, korean-writing, document-format, knowledge-quality | base-sync, model-update, korean-prose, knowledge-diagnosis | 철학과 늘 지킬 규칙, 씨앗 스킬의 배경, 평가기가 읽는(model, agents-md의 줄 한도) 모델 |
| 고르기 | event-log, user-identity | event-tracking | 사용자 행동을 모으는 프로젝트 |

씨앗 파일은 `AGENTS.md`, `CLAUDE.md`, `templates/`, `.githooks/`, `scripts/`, `.claude/settings.json`, `knowledge/skill-routing.md`다.
`knowledge/`에서 머리표가 없는 파일은 `knowledge/skill-routing.md`뿐이다(2026-10-26 확인).
