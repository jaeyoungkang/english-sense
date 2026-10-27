import pageData from "@/content/pages.json";
import siteData from "@/content/site.json";
import { studyPages } from "@/lib/study-content";

export type OptionKind = "en" | "ko" | "la";
export type QuizOption = { t: string; k: OptionKind; why: string };
type QuestionBase = { ch: number; who: string; scene: string; ask: string };
export type ChooseQuestion = QuestionBase & { type: "choose"; opts: QuizOption[]; feel: string };
export type ProduceQuestion = QuestionBase & { type: "produce"; answer: string; book: string | null; fixes: [string, string][] };
export type QuizQuestion = ChooseQuestion | ProduceQuestion;
export type QuizContent = { kind: "quiz"; questions: QuizQuestion[]; book: string; done: string; description: string };
export type Zone = { k: string; ex: string; ctx: string; lis: string; subj?: string; item?: string; a?: string; b?: string };
export type StageContent = { kind: "stage"; word: "have" | "get" | "be" | "go"; zones: Zone[]; heading: string; description: string };
export type StudyPart =
  | { kind: "reading-list" } | { kind: "reading"; id: string }
  | { kind: "prep-list" } | { kind: "prep-work"; id: string } | { kind: "prep-unit"; id: string; unit: number };
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
export const pages = [...(pageData as ContentPage[]), ...studyPages()];
export function getPage(slug: string[] = []) {
  const path = slug.length ? `${slug.join("/")}/` : "";
  return pages.find((page) => page.path === path);
}
