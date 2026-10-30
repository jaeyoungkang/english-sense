/**
 * The request the story lesson's "AI에게 설명 요청" button sends. It rests on the learner's first choice, the server judgement
 * and the canonical explanation that the AI context carries (`lessonContext`: passage, question, `correctOption`, `serverJudgement`).
 * The AI never changes the server judgement.
 */
export const storyExplainRequestMessage = "제가 처음 고른 보기와 서버 판정, 정본 해설을 바탕으로, 정본 답이 왜 그 보기인지와 다른 보기는 왜 아닌지 설명해 주세요. 보기는 화면에 보이는 A~D 글자로 불러 주세요. 본문의 어느 부분을 보면 되는지도 짚어 주세요. 판정은 그대로 두고, 스스로 다시 확인해 볼 지점을 알려 주세요.";

/** 화면과 AI 맥락이 보기를 부르는 글자. 0부터 센 보기 번호(`choice`·`answerIndex`)를 A~D로 바꾼다. */
export const optionLetter = (index: number) => String.fromCharCode(65 + index);

export type StorySenseLink = {
  word: "have" | "get" | "be" | "go" | "come";
  label: string;
  href: string;
};

export type StoryPublicGuide = {
  id: string;
  title: string;
  subtitleKo: string;
  synopsisKo: string;
  focusKo: string;
  senseGuides: readonly StorySenseLink[];
};

const SENSE_LINKS: Record<StorySenseLink["word"], StorySenseLink> = {
  have: { word: "have", label: "have · 내 공간 안에 두다", href: "/have/" },
  get: { word: "get", label: "get · 움직여 얻다·이르다", href: "/get/" },
  be: { word: "be", label: "be · 그 자리에 이 상태로 있다", href: "/be/" },
  go: { word: "go", label: "go · 지금 자리에서 멀어지다", href: "/go/" },
  come: { word: "come", label: "come · 기준 자리로 다가오다", href: "/come/" },
};

export const STORY_PUBLIC_GUIDES: readonly StoryPublicGuide[] = [
  {
    id: "green-umbrella",
    title: "The Green Umbrella",
    subtitleKo: "비 오는 날의 초록 우산과 다정한 쪽지",
    synopsisKo: "비 오는 날 카페를 나서던 미나가 우산꽂이에서 집어 든 초록 우산과 그 안에 적힌 짧은 쪽지에서 시작되는 영어 읽기 이야기입니다.",
    focusKo: "이동 방향을 가르는 go·come 감각과 둘레를 감싸는 around 그림을 장면 속에서 읽고 7개 퀴즈로 점검합니다.",
    senseGuides: [SENSE_LINKS.go, SENSE_LINKS.come],
  },
  {
    id: "bus-dog",
    title: "Ticket",
    subtitleKo: "12번 버스를 혼자 타는 개와 버스 기사",
    synopsisKo: "소도시 12번 버스에 정해진 정류장마다 혼자 올라타고 내리는 개와 그 사연을 따라가 보는 버스 기사의 영어 읽기 이야기입니다.",
    focusKo: "감춰진 사실이 드러나는 find out(out)과 시간이 이어지는 길이를 나타내는 for 감각을 읽고 7개 퀴즈로 훈련합니다.",
    senseGuides: [SENSE_LINKS.get, SENSE_LINKS.have],
  },
  {
    id: "prep-wonder-0",
    title: "Two Hands",
    subtitleKo: "옆집 저녁 피아노 소리와 두 손의 연주",
    synopsisKo: "매일 저녁 일곱 시 옆집 창문 너머로 들려오던 오르티즈 씨의 피아노 소리를 따라 이웃과 마음을 나누는 영어 읽기 이야기입니다.",
    focusKo: "원서 Wonder 읽기 전 핵심 표현(used to / be used to, end up, be like)의 구어 감각을 이야기와 7개 퀴즈로 익힙니다.",
    senseGuides: [SENSE_LINKS.be, SENSE_LINKS.get],
  },
  {
    id: "prep-wonder-1",
    title: "Night School",
    subtitleKo: "일흔네 살에 시작한 할머니의 야간학교",
    synopsisKo: "일흔네 살에 처음 학교 교실에 들어선 할머니와 함께 저녁 수업을 따라가며 배움의 기쁨을 마주하는 영어 읽기 이야기입니다.",
    focusKo: "Wonder 1부 핵심 표현(get to, Why don't you ~?, stare at)의 어감과 시선 차이를 이야기와 7개 퀴즈로 훈련합니다.",
    senseGuides: [SENSE_LINKS.get, SENSE_LINKS.go],
  },
  {
    id: "prep-wonder-2",
    title: "Rush Hour",
    subtitleKo: "처음 혼자 타 본 출퇴근길 지하철",
    synopsisKo: "늘 부모님 차로만 이동하던 아이가 처음으로 혼자 지하철 개찰구를 통과하며 겪는 유쾌한 출퇴근길 영어 읽기 이야기입니다.",
    focusKo: "Wonder 2부 핵심 표현(the moment, not once, What's up?)의 장면 감각을 이야기와 7개 퀴즈로 익힙니다.",
    senseGuides: [SENSE_LINKS.go, SENSE_LINKS.have],
  },
  {
    id: "prep-wonder-3",
    title: "Leaving in June",
    subtitleKo: "다섯 살부터 단짝이던 친구와 6월의 소식",
    synopsisKo: "유치원 시절부터 매일 버스 옆자리에 앉던 단짝 친구 클로이와 오해를 풀고 진짜 소식을 나누는 영어 읽기 이야기입니다.",
    focusKo: "Wonder 3부 핵심 표현(keep -ing, mad at, talk to)의 관계·지속 감각을 이야기와 7개 퀴즈로 훈련합니다.",
    senseGuides: [SENSE_LINKS.be, SENSE_LINKS.have],
  },
  {
    id: "prep-wonder-4",
    title: "Ask Dude",
    subtitleKo: "학교 신문 익명 고민 상담 칼럼의 비밀",
    synopsisKo: "금요일마다 나오는 학교 신문 고민 상담 칼럼 ‘Ask Dude’의 답장 담당을 맡게 되면서 벌어지는 영어 읽기 이야기입니다.",
    focusKo: "Wonder 4부 핵심 표현(as soon as, not even, let me)의 타이밍과 강조 감각을 이야기와 7개 퀴즈로 익힙니다.",
    senseGuides: [SENSE_LINKS.have, SENSE_LINKS.get],
  },
  {
    id: "prep-wonder-5",
    title: "Bubbles",
    subtitleKo: "일주일 동안 맡은 이웃집 금붕어 돌보기",
    synopsisKo: "여행을 떠난 이웃 노라네 금붕어를 일주일 동안 돌보며 가족 사이에 오가는 따뜻한 배려를 담은 영어 읽기 이야기입니다.",
    focusKo: "Wonder 5부 핵심 표현(not a big deal, shake one's head, pretend)의 일상 대화 감각을 이야기와 7개 퀴즈로 훈련합니다.",
    senseGuides: [SENSE_LINKS.have, SENSE_LINKS.be],
  },
  {
    id: "prep-wonder-6",
    title: "Step, Step, Slide",
    subtitleKo: "밤마다 거실에서 들려오는 발소리",
    synopsisKo: "밤늦게 아래층 거실에서 들려오는 규칙적인 발소리의 주인공과 가족의 기념일 준비를 그린 영어 읽기 이야기입니다.",
    focusKo: "Wonder 6부 핵심 표현(이야기체 화자 도치, just started -ing, could hear)의 서술 감각을 이야기와 7개 퀴즈로 익힙니다.",
    senseGuides: [SENSE_LINKS.come, SENSE_LINKS.go],
  },
  {
    id: "prep-wonder-7",
    title: "The Volunteer",
    subtitleKo: "마술 쇼 무대 위 긴장과 객석의 지원군",
    synopsisKo: "형에게 배운 동전 마술로 학교 장기자랑 무대에 올라 떨리는 순간을 넘기는 동생의 영어 읽기 이야기입니다.",
    focusKo: "Wonder 7부 핵심 표현(What's going on?, last-minute nerves, was going to)의 현장 감각을 이야기와 7개 퀴즈로 훈련합니다.",
    senseGuides: [SENSE_LINKS.go, SENSE_LINKS.be],
  },
  {
    id: "prep-wonder-8",
    title: "Known for Something",
    subtitleKo: "사라진 교실 햄스터와 작은 용기",
    synopsisKo: "중학교 과학실 햄스터 피클스가 사라진 날 조용하던 친구의 말에 귀를 기울이고 함께 찾아 나서는 영어 읽기 이야기입니다.",
    focusKo: "Wonder 8부 핵심 표현(stand up for, take your seats, no way)의 교실 장면 감각을 이야기와 7개 퀴즈로 익힙니다.",
    senseGuides: [SENSE_LINKS.be, SENSE_LINKS.have],
  },
  {
    id: "prep-groundhog-day-0",
    title: "Tuesday Again",
    subtitleKo: "매일 아침 반복되는 듯한 화요일의 식당",
    synopsisKo: "아침 6시 30분 라디오 소리부터 단골손님의 행동까지 어제와 똑같이 흘러가는 아침 식당 풍경을 담은 영어 읽기 이야기입니다.",
    focusKo: "영화 Groundhog Day 핵심 표현(Come on, Am I right?, gotta go)의 생생한 구어 감각을 이야기와 7개 퀴즈로 훈련합니다.",
    senseGuides: [SENSE_LINKS.come, SENSE_LINKS.go],
  },
  {
    id: "prep-zootopia-0",
    title: "The Missing Pie",
    subtitleKo: "사라진 사과파이 사건을 맡은 꼬마 탐정",
    synopsisKo: "창가에 식혀 두었던 할머니의 사과파이가 사라지자 단서를 모아 사건의 전말을 밝혀내는 남매의 영어 읽기 이야기입니다.",
    focusKo: "영화 Zootopia 핵심 표현(hustle, take the case, just)의 대화 어감을 이야기와 7개 퀴즈로 익힙니다.",
    senseGuides: [SENSE_LINKS.get, SENSE_LINKS.have],
  },
  {
    id: "prep-inside-out-0",
    title: "No Stars",
    subtitleKo: "새벽 유성우를 기다리며 나눈 부자의 기억",
    synopsisKo: "유성우를 보러 새벽 일찍 길을 나섰다가 뜻밖의 진흙길과 구름 아래에서 오래 남을 대화를 나누는 영어 읽기 이야기입니다.",
    focusKo: "영화 Inside Out 핵심 표현(I've got this, be supposed to, used to)의 감정·기대 감각을 이야기와 7개 퀴즈로 훈련합니다.",
    senseGuides: [SENSE_LINKS.get, SENSE_LINKS.be],
  },
  {
    id: "prep-the-intern-0",
    title: "The Seven O'Clock E-mails",
    subtitleKo: "첫 출근 날 아침 7시에 도착한 이메일",
    synopsisKo: "서점 첫 출근 날부터 매일 아침 7시 정각에 도착하는 친절한 안내 이메일의 주인공을 찾아가는 영어 읽기 이야기입니다.",
    focusKo: "영화 The Intern 핵심 표현(..., right?, let me take a look at, feel like)의 직장 대화 감각을 이야기와 7개 퀴즈로 익힙니다.",
    senseGuides: [SENSE_LINKS.have, SENSE_LINKS.get],
  },
];

const GUIDE_BY_ID = new Map<string, StoryPublicGuide>(STORY_PUBLIC_GUIDES.map(guide => [guide.id, guide]));

export function getStoryPublicGuide(storyId: string): StoryPublicGuide | undefined {
  return GUIDE_BY_ID.get(storyId);
}

export function getStoryAdjacentLinks(storyId: string): {
  prev?: { id: string; title: string; subtitleKo: string; href: string };
  next?: { id: string; title: string; subtitleKo: string; href: string };
} {
  const index = STORY_PUBLIC_GUIDES.findIndex(guide => guide.id === storyId);
  if (index < 0) return {};
  const prev = index > 0 ? STORY_PUBLIC_GUIDES[index - 1] : undefined;
  const next = index + 1 < STORY_PUBLIC_GUIDES.length ? STORY_PUBLIC_GUIDES[index + 1] : undefined;
  return {
    ...(prev ? { prev: { id: prev.id, title: prev.title, subtitleKo: prev.subtitleKo, href: `/reading/${prev.id}/` } } : {}),
    ...(next ? { next: { id: next.id, title: next.title, subtitleKo: next.subtitleKo, href: `/reading/${next.id}/` } } : {}),
  };
}
