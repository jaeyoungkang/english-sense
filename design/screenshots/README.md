# 화면 확인 자료

2026-10-26 운영 주소의 격리 브라우저에서 저장한 입력 통일 화면이다.
배포 판은 `9c59881a-eabc-4957-9ca3-6cfe71494dca`다. 강PD의 학습 수행을 기록하지 않았다.

- `unified-input-desktop.png`: 본문과 오른쪽 첫 답 입력, 1440×960 CSS px.
- `unified-input-desktop-conversation.png`: 왼쪽 문제·보기·수행 열람과 오른쪽 첫 답·질문·모의 피드백을 함께 읽는 화면.
- `unified-input-desktop-session.png`: 왼쪽 2번 퀴즈와 오른쪽 2번 첫 답 초안. 첫 답 입력은 본문에 없다.
- `unified-input-mobile-content.png`: 고정 입력이 문서를 가리지 않는 휴대폰 콘텐츠, 390×844 CSS px Chromium 에뮬레이션.
- `unified-input-mobile-answer.png`: 본문의 연결 버튼으로 이동한 첫 답 입력. 문제 대상과 단계를 표시한다.
- `unified-input-mobile-chat.png`: 같은 대화 칸에서 명시적으로 제출 전 질문으로 전환한 상태.
- `unified-input-mobile-short.png`: 320×430 CSS px에서 대화 안의 첫 답을 읽는 상태. 긴 폼은 내부 스크롤로 조작한다.

모의 응답·검증 초안은 실제 AI 결과나 강PD의 학습 기록이 아니다. 화면 일곱 장에서 가로 넘침·중복 DOM ID·브라우저 오류는 발견하지 못했다. 실제 iOS 키보드·화면 읽기 도구의 검증은 아니다.
동시 참조·위치 독립·조작·복원과 모델 판단의 근거는 `docs/tasks/content-chat-workspace.md`에 있다.
`content-chat-*`는 이전 두 칸 배치이며, 그 밖의 그림도 이전 시안·단일 문제·퀴즈 아티팩트·단일 세로 문서의 화면이다. 현재 입력 통일 디자인의 근거로 쓰지 않는다.
