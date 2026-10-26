---
name: korean-prose
description: 한국어 작문법 모델을 따라 한국어 글을 쓰거나 다듬는 방법. 한국어 문서, 이슈와 댓글, PR 설명, 커밋 본문, 답변에 싣는 문안을 쓰기 전에 먼저 불러 쓰고, 이미 쓴 글을 한국어 어법에 맞게, 자연스럽게 다시 써 달라는 요청에도 쓴다. 한국어 글쓰기, 한국어 교정, 한국어 어법, 한국어법, 어색한 말, 문장 다듬기, Korean prose/writing.
metadata:
  picked_from: "project-base:korean-prose@abec83e02269a2460d1ac459bda213c338942d2f"
  background: "korean-writing@d0ef635740b10ce5901f26b8219bc7979d40e3b8, document-format@d0ef635740b10ce5901f26b8219bc7979d40e3b8"
---

# Korean Prose — 한국어답게 쓰고 다듬기

이 스킬은 한국어 글을 쓰거나 다듬는 순서다. 무엇을 어떻게 고치는지는 배경 모델 `knowledge/domain/korean-writing.md`에,
내용을 어떤 꼴에 담을지는 `knowledge/domain/document-format.md`에 있고, 이 스킬은 다시 적지 않는다. 확인한 문헌의 범위는 [문헌 참고 기록](references/uri-geul-baro-sseugi.md)에 있다.

## 작성과 교정 순서

1. 독자와 글의 목적, 사실 근거를 확인한다. 고칠 대상과 바꾸지 않을 것(코드, 경로, 정한 용어)은
   `knowledge/domain/korean-writing.md` "적용 범위"로 가른다. 그다음 입으로 말하듯 초안을 쓴다.
2. 따라 쓴 말을 찾아 푼다(`knowledge/domain/korean-writing.md` "따라 쓴 말"). 일괄로 바꾸지 않고 각 말의 역할을 본다.
3. 원문이나 근거와 대조해 뜻의 관계와 어감이 유지됐는지 본다(`knowledge/domain/korean-writing.md` "뜻과 어감"). 뜻을
   확인할 수 없는 곳은 고치지 않고 그 자리를 알린다.
4. 호응, 수식, 가리키는 말, 시제와 문체를 점검한다(`knowledge/domain/korean-writing.md` "호응과 문체").
5. 형식이 내용에 맞는지 본다(`knowledge/domain/document-format.md` "규칙").
6. 바꾼 문장을 앞뒤 문맥에서 다시 읽는다. 왜 고쳤는지를 따라 쓴 말, 뜻의 모호함, 어법 오류 가운데 무엇인지로 설명할 수
   있어야 한다.

## 스킬과 모델을 고친 뒤 확인

이 스킬이나 배경 모델의 교정 예를 고치면, 예마다 고치기 전후의 뜻과 판단 기준이 맞는지 본다. 입으로 하는 말에 가까워
그대로 두는 사례, 조건과 부정을 지키는 사례, 뜻이 모호해 교정을 보류하는 사례도 함께 본다. 형식 검사를 통과했다고 실제로
쓴 글의 품질이 좋다고 보지 않는다.

이 프로젝트에 맞춘 것(적용 대상, 말, 검사 절차)은 같은 폴더의 `project.md`에 있다.
