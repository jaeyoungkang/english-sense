import pageData from "@/content/pages.json";
import siteData from "@/content/site.json";

export type OptionKind = "en" | "ko" | "la";
export type QuizOption = { t: string; k: OptionKind; why: string };
type QuestionBase = { ch: number; who: string; scene: string; ask: string };
export type ChooseQuestion = QuestionBase & { type: "choose"; opts: QuizOption[]; feel: string };
export type ProduceQuestion = QuestionBase & { type: "produce"; answer: string; book: string | null; fixes: [string, string][] };
export type QuizQuestion = ChooseQuestion | ProduceQuestion;
/** 빈칸 넣기: 책의 앞뒤 문장과 빈칸이 든 문장을 보이고, 힌트·모범 답·감각은 요청해야 나온다. */
export type FillQuestion = { type: "fill"; ch: number; who: string; ask: string; before: string[]; blank: string; after: string[]; hintKo: string; hintVerb: string; hintWords: string[]; answer: string; book: string; feel: string; fixes: [string, string][] };
export type QuizPageQuestion = QuizQuestion | FillQuestion;
export type QuizContent = { kind: "quiz"; questions: QuizPageQuestion[]; book: string; done: string; description: string };
export type Zone = { k: string; ex: string; ctx: string; lis: string; subj?: string; item?: string; a?: string; b?: string };
export type StageContent = { kind: "stage"; word: "have" | "get" | "be" | "go" | "come"; zones: Zone[]; heading: string; description: string };
export type StudyPart =
  | { kind: "reading-hub" } | { kind: "reading-list" } | { kind: "reading"; id: string }
  | { kind: "prep-list" } | { kind: "prep-work"; id: string } | { kind: "prep-unit"; id: string; unit: number }
  | { kind: "scene-workspace" };
export type ContentPart = { kind: "html"; html: string } | StageContent | QuizContent | { kind: "ask" } | StudyPart;
export type ContentPage = {
  path: string;
  title: string;
  description: string;
  h1?: string;
  menu?: string;
  crumbs?: [string, string | null][];
  og?: string;
  type?: "website" | "article";
  ld?: string;
  parts: ContentPart[];
};

export const site = siteData;
/** pages.json의 공개 페이지. 읽기·사전 훈련 페이지를 합친 전체 목록은 lib/server/site-pages.ts에 있다. */
export const contentPages = pageData as ContentPage[];
