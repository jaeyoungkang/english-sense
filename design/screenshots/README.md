# 화면 확인 자료

2026-10-26 운영 주소의 격리 브라우저에서 저장한 콘텐츠·대화 분리 화면이다.
배포 판은 `5f36c6a1-0c59-4fcf-b0bf-ad13d065ba3b`다. 강PD의 학습 수행을 기록하지 않았다.

- `content-chat-desktop.png`: 목차·콘텐츠 문서·AI 대화를 나란히 둔 첫 화면, 1440×960 CSS px.
- `content-chat-desktop-session.png`: 왼쪽 2번 퀴즈와 답 초안, 오른쪽 1번 수행·모의 응답을 함께 읽는 화면. 모의 응답은 실제 AI 결과나 학습 기록이 아니다.
- `content-chat-mobile-content.png`: 고정 입력이 문서를 가리지 않는 휴대폰 콘텐츠, 390×844 CSS px Chromium 에뮬레이션.
- `content-chat-mobile-chat.png`: 문서 아래로 이어지는 대화와 입력. 문서·대화 이동으로 탭 없이 오간다.
- `content-chat-mobile-short.png`: 320×430 CSS px에서 실제 퀴즈 본문을 읽는 상태. 대화 입력은 문서를 덮지 않는다.

화면 다섯 개에서 가로 넘침·중복 DOM ID·브라우저 오류는 발견하지 못했다. 실제 iOS 키보드·화면 읽기 도구의 검증은 아니다.
동시 참조·위치 독립·조작·복원과 모델 판단의 근거는 `docs/tasks/content-chat-workspace.md`에 있다.
그 밖의 그림은 이전 시안·단일 문제·퀴즈 아티팩트·단일 세로 문서의 화면이다. 현재 운영 디자인의 근거로 쓰지 않는다.
