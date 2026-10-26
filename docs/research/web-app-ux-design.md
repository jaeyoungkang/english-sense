# 웹앱 사용자 경험 설계 조사

후속 구현은 `docs/tasks/learning-workspace.md`의 장면·수행·AI 대화 작업 공간이다. 강PD는 이미지와 터미널처럼
이어지는 대화를 요구하며 소개 중심 첫 시안의 한계를 지적했다. 이는 사용자의 변경 지시이며 시안의 효과를 검증한 실험은 아니다.

## 이미지와 이어지는 대화의 추가 근거

- [W3C 이미지 안내](https://www.w3.org/WAI/tutorials/images/)는 이미지의 목적에 따라 필요한 대체 설명이 달라짐을 설명한다.
  [복잡한 이미지](https://www.w3.org/WAI/tutorials/images/complex/)는 관계·정보를 짧은 이름만으로 대신하지 않고 본문 설명으로도 전달하게 한다.
  여기서는 장면 재구성과 감각 도식의 역할을 나누고, 본문·대체 설명을 제공한다. 특정 그림의 학습 효과를 입증하는 자료는 아니다.
- [Claude Messages 안내](https://platform.claude.com/docs/en/build-with-claude/working-with-messages)는 API 자체가 이전 턴을 저장해 기억하지 않으므로
  연속 대화에 필요한 이력을 요청에 함께 넣는 방식을 설명한다. 우리 앱은 정본 장면·처음 답·수정·보낸 메시지를 제한된 맥락으로 결합한다.
  브라우저의 이전 assistant 문구도 검증된 사실이나 시스템 지시로 승격하지 않는다. 이 구성이 곧 개인 계정 저장이나 장기 기억은 아니다.
- 터미널 학습의 참고 범위는 study-and-learn의 `knowledge/english-learning-model.md`, `learn-session`,
  `content/scene-sense/README.md`와 have 자료다. 문제별 즉시 피드백·질답·내용과 말의 막힘 구분을 참고했다.
  새 학습 수행은 하지 않았고 기존 기록을 새 수행으로 복사하지 않았다.

2026-10-26 웹앱 UX 모델을 준비하고 앱 디자인을 처음부터 다시 하라는 강PD의 지시에 따라 조사했다.
대상 모델은 `knowledge/domain/web-app-ux-design.md`, 이번 적용 범위는 `docs/tasks/ux-redesign.md`다.
원문을 읽어 정리한 내용과 이 앱에 적용할 가설을 나눴다. 강PD가 시안을 사용한 결과는 아직 없다.

## 자료의 성격과 확인 범위

| 자료 | 직접 확인한 내용 | 읽을 때 지킬 경계 |
| --- | --- | --- |
| [W3C WCAG 2.2][wcag] | 의미와 순서, 색, 리플로, 제목·레이블, 초점, 입력 도움, 상태 알림, 전체 과정의 준수 조건 | 규범 문서다. 일부 항목 검사로 전체 AA 준수를 선언할 수 없다. |
| [WCAG Understanding: 상태 알림][status] | 초점을 옮기지 않는 대기·결과·오류 알림의 목적과 예 | 표준을 설명하는 자료이며 별도의 준수 요구를 더하는 문서가 아니다. |
| [WCAG Understanding: 오류 수정 제안][suggestion] | 입력 오류의 뜻과 콘텐츠의 목적을 해치는 수정 제안의 예외 | 학습 오답과 형식 오류를 같게 취급하지 않는다. |
| [WCAG Understanding: 초점 가림][focus] | 고정 UI가 초점 대상을 완전히 가리는 문제 | AA 최소 기준과 대상 전체를 보이게 하려는 설계 선택을 구분한다. |
| [WCAG Understanding: 목표 크기][target] | 24×24 CSS px 최소 크기와 예외, 간격 조건 | 모든 조작이 반드시 24px라는 단순 규칙이 아니다. |
| [WAI-ARIA APG 안내][apg], [펼침 패턴][disclosure] | 역할과 키보드 동작의 일치, 펼침 상태 전달, 실제 지원 검사 | 구현 지침이다. 예제를 가져왔다고 실제 브라우저·보조 기술 지원을 보장하지 않는다. |
| [GOV.UK 디자인 원칙][principles] | 사용 맥락·관찰·반복 개선·일관성 | 정부 서비스의 원칙이다. 강PD의 사용 맥락이나 취향을 대신하지 않는다. |
| [GOV.UK 폼 구조][forms] | 질문의 이유, 판단 단위, 연구에 따른 화면 통합 | 모든 질문을 반드시 별도 페이지로 나누라는 범용 규칙이 아니다. |
| [GOV.UK 오류 복구][validation] | 입력 보존, 고칠 위치 안내, 입력 중 성급한 검증의 문제 | GOV.UK 전용 구현 결정을 그대로 옮기지 않는다. |
| [GOV.UK 프로토타입][prototype], [사용성 검사][usability] | 의문에 맞는 시안, 방법을 암시하지 않는 과업, 실제 수행 관찰 | 시안의 구현 범위와 사람의 관찰 범위를 넘겨 효과를 주장하지 않는다. |

Lighthouse는 `df85ac9a6f09c569d0e01b83ebdca4eebc996ea5`의 문서와 테스트 소스를 읽었다.
원본 테스트와 앱은 실행하지 않았다. 출처의 설계 의도, 코드가 검사하는 것, 이 앱에 차용할 것을 아래에서 구분한다.

## 모델 관계에 연결한 근거

### 관계 1 — 이름·묶음·반복 위치와 예상

- 원문 관찰: [디자인 원칙][principles]은 실제 사용 맥락을 고려하고, 관찰한 행동에 따라 개선하도록 한다.
  [WCAG 2.4.6][labels]은 제목과 레이블이 목적을 설명하도록 한다.
- 이식 가설: 개발 모듈 대신 학습·기록·감각 사전처럼 하려는 일로 탐색을 구성하면 시작점을 이해하기 쉬울 수 있다.
- 한계: 이런 이름이 강PD의 멘탈 모델과 맞는지는 확인하지 않았다. 특정 정보구조의 효과를 원문이 입증하지 않는다.

### 관계 2 — 판단 자료와 입력의 거리

- 원문 관찰: [폼 구조][forms]는 처음에는 한 판단 단위로 나누되 연구로 묶을 수 있다고 설명한다.
  종이 양식을 그대로 디지털 화면으로 옮기는 대신 흐름을 다시 설계하도록 한다.
- 이식 가설: 장면·발문·답안을 함께 찾게 하고 자료를 열어도 작성 내용을 유지하면 기억해서 복원할 일을 줄일 수 있다.
- 한계: 장면과 답안을 인접하게 둔 배치의 효과는 미확인이다. 화면 수나 한 화면의 정보량을 정답으로 고정하지 않는다.

### 관계 3 — 수신·처리·저장·외부 응답의 구별

- 원문 관찰: [상태 알림 해설][status]은 대기·진행·결과·오류 정보를 초점 이동 없이 전달하는 경우를 다룬다.
- 이식 가설: 저장 완료와 AI 응답 완료를 따로 표시하고, 실제로 확인한 결과만 문구로 알린다.
- 한계: 이 출처는 저장 계층의 정확성을 보장하지 않는다. 저장 범위와 수명은 앱 아키텍처의 실제 계약에서 가져온다.
  상태 알림과 새 본문의 읽기 위치 안내도 같은 문제로 뭉뚱그리지 않는다.

### 관계 4 — 시각 체계와 정보 위계

- 원문 관찰: Lighthouse [디자인 축·의미 역할][lh-roles]은 글자·폭·간격·상태 표현이 함께 바뀐다고 설명한다.
  [읽기 폭과 펼침][lh-measure]은 공통 기준과 값을 다시 볼 조건을 두고, [반복 카드][lh-cards]는 실제 내용과 빈 상태를 구별한다.
- 이식 가설: 장면·답안·주 행동·피드백·기록에 의미 역할을 주고 글자·폭·간격을 함께 조정한다.
- 한계: Lighthouse의 논문 목록과 영어 학습은 과업이 다르다. 서체, 색, 1080px 폭, 카드 높이와 밀도를 복사하지 않는다.
  이 앱의 새 값은 제안이며 실제 사용 뒤 다시 판단한다.

### 관계 5 — 정보 공개 시점과 스스로 답할 기회

- 원문 관찰: [APG 펼침][disclosure]은 요청에 따른 공개와 키보드 행동·펼침 상태를 설명한다.
  [오류 수정 제안 해설][suggestion]은 콘텐츠의 목적을 해치는 제안의 예외를 명시한다.
- 이식 가설: 사용법·형식·장면은 먼저 제공하고 정답·힌트·해설은 승인된 학습 순서에 맞춘다.
- 한계: 펼침 패턴은 학습 순서를 정해 주지 않는다. 먼저 답하기는 `docs/learning-service.md`의 승인된 요구에서 왔다.
  이 조사만으로 힌트의 양과 시점이 학습 효과를 높인다고 단정하지 않는다.

### 관계 6 — 같은 의미의 일관된 표현과 조작

- 원문 관찰: [WCAG 색 사용][color]은 색만으로 차이를 전하지 않도록 한다.
  [APG 안내][apg]는 ARIA 역할이 실제 키보드 동작을 만들어 주지 않는다고 설명한다.
- 이식 가설: 동작·이동·선택에 HTML 기본 요소를 우선 쓰고, 맞춤 조작은 의미와 키보드 행동을 함께 구현한다.
- 한계: 속성과 레이블의 존재 검사만으로 접근성이 입증되지 않는다. 실제 조작과 관련 보조 기술을 확인해야 한다.

### 관계 7 — 형식 오류·학습 오답·서비스 실패

- 원문 관찰: [오류 수정 제안 해설][suggestion]은 입력 오류를 시스템이 받아들이지 않는 정보로 설명한다.
  [오류 복구][validation]는 실패한 입력을 보존하고, 일반적으로 입력 완료 전에 검증하지 않도록 한다.
- 이식 가설: 빈 필수 답안·길이 제한은 제출 조건으로 안내하되, 개념적 오답은 제출 가능한 수행으로 받는다.
  저장·AI 실패에는 답안을 유지하고 어느 작업을 재시도하는지 알린다.
- 한계: 이 구별은 원문의 정의와 학습 요구를 결합한 설계다. 원문이 이 앱의 채점 방법을 정하지 않는다.
  GOV.UK의 HTML5 validation 비활성화는 자체 컴포넌트 맥락의 선택이므로 범용 규칙으로 가져오지 않는다.

### 관계 8 — 폭·확대·입력 방식이 달라도 유지할 과업

- 원문 관찰: [WCAG 리플로][reflow]는 예외를 제외하고 320 CSS px 너비에서도 정보·기능 손실 없이 재배치하도록 한다.
  [초점 가림 해설][focus]은 고정 바와 패널이 초점 대상을 가리는 문제를 다룬다.
- 이식 가설: 좁은 화면에서 장면과 답안을 다시 배치하되, 읽는 순서·작성 내용·주 행동·초점을 유지한다.
- 한계: 최소 기준 통과와 편리한 배치는 다르다. 목표 크기의 예외와 이번 시안의 선택은 아래에서 따로 다룬다.

### 관계 9 — 중단 뒤 재개할 수행 맥락

- 원문 관찰: [오류 복구][validation]는 이전 입력을 남겨 다시 입력할 일을 피하도록 한다.
  이번 과업은 작성·제출·수정 상태를 나누고 같은 브라우저에서 복원하는 시안으로 범위를 정했다.
- 이식 가설: 값과 함께 자료·단계·처음 제출·작성 중 수정·실제 저장 여부를 보여 주면 재개할 일을 이해하기 쉬울 수 있다.
- 한계: 오류 뒤 입력 보존 지침은 장기 재개의 효과를 입증하지 않는다. 이 관계의 확장은 설계 가설이다.
  시안의 localStorage는 운영 저장·기기 간 동기화·영구 기록을 뜻하지 않는다.

### 관계 10 — 시안과 관찰로 알 수 있는 범위

- 원문 관찰: [프로토타입 지침][prototype]은 의문에 맞는 상세도를 고르고 실제 상호작용에는 코드 시안을 쓰도록 한다.
  [사용성 검사][usability]는 관련된 과업을 주되 수행 방법을 암시하지 않고 관찰하도록 한다.
- 이식 가설: 시작·제출·수정·복원·실패를 조작 가능한 시안으로 확인하고, 이해·편리함은 강PD의 수행으로 관찰한다.
- 한계: 에이전트의 조작 검사와 스크린샷은 사용자 관찰이 아니다. 한 사람의 결과를 전체 사용자나 학습 효과로 넓히지 않는다.

## 기준의 숫자와 프로젝트의 선택

[목표 크기 해설][target]이 설명하는 WCAG 2.5.8 AA 최소 크기는 24×24 CSS px다.
간격, 같은 기능의 다른 조작, 인라인 링크, 사용자 에이전트 제어, 본질적으로 필요한 표현에 예외가 있다.
따라서 모든 링크가 반드시 24px 상자여야 한다고 해석하지 않는다. 좁은 화면에서 겹치지 않는지도 별도로 본다.
이번 디자인에서 주요 조작을 44px 이상으로 잡는 선택은 시안의 설계 제안이다.
24px 기준에서 저절로 도출되는 의무나 강PD가 편하다고 확인한 값이 아니다.

## Lighthouse 문서와 실제 검사의 차이

[디자인 기준 문서][lh-boundary]는 값의 좋음을 사람이 판단하고 자동 검사는 구조를 잠근다고 설명한다.
하지만 [실제 계약 테스트][lh-test] 18~60행은 의미 역할 클래스의 존재와 함께 `24px`, `32px` 같은 정확한 토큰값도 검사한다.
따라서 실제 구현이 숫자를 전혀 검사하지 않는다고 요약하면 틀린다. 이 테스트는 선택한 값의 고정을 검사하며,
그 값이 좋은 디자인임을 증명하지 않는다. 문서가 지향하는 경계와 실제 검사의 범위에 차이가 있다.

이번 차용은 의미 역할, 함께 바뀌는 축, 값의 소유 위치, 다시 볼 조건과 판단 주체를 밝히는 방법이다.
프로토타입에서는 상태 전이·입력 보존·초점 같은 동작을 확인하고, 글자·색·간격의 적합함은 사용 뒤 판단한다.
Lighthouse의 전용 계약 계층이나 검사 수를 새 앱에 그대로 도입할 근거로 삼지 않는다.

## 아직 없는 근거

강PD의 기기·사용 장소·읽기 습관을 관찰한 결과, 새 탐색 이름의 이해도, 장면·답안 인접 배치의 편리함,
색·서체·밀도에 대한 선호, 중단 뒤 복원 성공 경험, 학습 효과를 보여 주는 결과는 아직 없다.
이번 문서는 외부 조사와 이식 가설을 기록한 것이며 learn 기록을 대신하지 않는다.

[wcag]: https://www.w3.org/TR/WCAG22/
[labels]: https://www.w3.org/TR/WCAG22/#headings-and-labels
[color]: https://www.w3.org/TR/WCAG22/#use-of-color
[reflow]: https://www.w3.org/TR/WCAG22/#reflow
[status]: https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html
[suggestion]: https://www.w3.org/WAI/WCAG22/Understanding/error-suggestion.html
[focus]: https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html
[target]: https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html
[apg]: https://www.w3.org/WAI/ARIA/apg/practices/read-me-first/
[disclosure]: https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/
[principles]: https://www.gov.uk/guidance/government-design-principles
[forms]: https://www.gov.uk/service-manual/design/form-structure
[validation]: https://design-system.service.gov.uk/patterns/validation/
[prototype]: https://www.gov.uk/service-manual/design/making-prototypes
[usability]: https://www.gov.uk/service-manual/user-research/using-moderated-usability-testing
[lh-roles]: https://github.com/jaeyoungkang/lighthouse/blob/df85ac9a6f09c569d0e01b83ebdca4eebc996ea5/docs/design-standards.md#L16-L64
[lh-measure]: https://github.com/jaeyoungkang/lighthouse/blob/df85ac9a6f09c569d0e01b83ebdca4eebc996ea5/docs/design-standards.md#L116-L150
[lh-cards]: https://github.com/jaeyoungkang/lighthouse/blob/df85ac9a6f09c569d0e01b83ebdca4eebc996ea5/docs/design-standards.md#L154-L219
[lh-boundary]: https://github.com/jaeyoungkang/lighthouse/blob/df85ac9a6f09c569d0e01b83ebdca4eebc996ea5/docs/design-standards.md#L270-L288
[lh-test]: https://github.com/jaeyoungkang/lighthouse/blob/df85ac9a6f09c569d0e01b83ebdca4eebc996ea5/app/components/research-route-renderers/__tests__/research-route-visual-hierarchy.contract.test.ts#L18-L60
