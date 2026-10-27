import { splitBlanks } from "./fill-blank";
import type { PublicLearningCatalog } from "./learning-catalog";
import type { OpenedCard } from "./lesson-contract";
import type { PublicCardsLesson, PublicStoryLesson } from "./lesson-registry";
import { runsText, type NoteRun } from "./notes";
import type { ReferenceMaterial } from "./reference-materials";

/**
 * The text blocks of each lesson that a pen note may sit on, with the key each block carries as `data-note-block`.
 * The screens build a block's runs here and the same runs give the text the notes are found in, so a note can be
 * found even while its block is not on screen (the story body is covered after the reading). Public text only:
 * no answer, explanation or basis of a judged question is a block.
 */

export type NoteBlocks = Record<string, NoteRun[]>;
export const blockTexts = (blocks: NoteBlocks): Record<string, string> => Object.fromEntries(Object.entries(blocks).map(([key, runs]) => [key, runsText(runs)]));

const plain = (text: string): NoteRun[] => [{ text }];

/* ---------- story ---------- */

export const storyBodyKey = (index: number) => `body-${index}`;
export const isStoryBodyKey = (key: string) => key.startsWith("body-");
export const storyAskKey = (questionId: string) => `q-${questionId}-ask`;
export const storyOptionKey = (questionId: string, index: number) => `q-${questionId}-o${index}`;
export const isStoryQuestionKey = (key: string) => key.startsWith("q-");

export const storyParagraphRuns = (paragraph: PublicStoryLesson["paragraphs"][number]): NoteRun[] => paragraph.map(piece => piece.em ? { text: piece.text, wrap: "i" } : { text: piece.text });

export function storyBlocks(lesson: PublicStoryLesson): NoteBlocks {
  const blocks: NoteBlocks = {};
  lesson.paragraphs.forEach((paragraph, index) => { blocks[storyBodyKey(index)] = storyParagraphRuns(paragraph); });
  for (const question of lesson.questions) {
    blocks[storyAskKey(question.questionId)] = plain(question.question);
    question.options.forEach((option, index) => { blocks[storyOptionKey(question.questionId, index)] = plain(option); });
  }
  return blocks;
}

/* ---------- cards ---------- */

export const cardKey = (questionId: string, field: "meaning" | "sense" | "example" | "sentence" | "basis") => `card-${questionId}-${field}`;
/** The blank sentence: the text around the blanks, each blank one unit. */
export function cardSentenceRuns(sentence: string): NoteRun[] {
  const pieces = splitBlanks(sentence), runs: NoteRun[] = [];
  pieces.forEach((piece, index) => { if (piece) runs.push({ text: piece }); if (index < pieces.length - 1) runs.push({ gap: "input" }); });
  return runs;
}
export const cardBasisRuns = (basis: string): NoteRun[] => plain(`근거: ${basis}`);

/** The fields a card shows only after its first answer. Their text comes from the judgement's `card`, never from the public lesson. */
const OPENED_FIELD = /^card-(.+)-(sense|example|basis)$/;
/**
 * True for a block of a card of this lesson that is still closed: its text is not known to the page yet, so a note cannot be made on it
 * and a note kept from before waits for the card to open. A block of a card the lesson no longer has is not one of these.
 */
export const isClosedCardBlock = (lesson: Pick<PublicCardsLesson, "cards">, key: string, opened: (questionId: string) => OpenedCard | null) => {
  const match = OPENED_FIELD.exec(key);
  return !!match && lesson.cards.some(card => card.questionId === match[1]) && !opened(match[1]);
};

/** A closed card offers its meaning and blank sentence. Sense, example and basis are blocks only once the card is open. */
export function cardBlocks(lesson: PublicCardsLesson, opened: (questionId: string) => OpenedCard | null): NoteBlocks {
  const blocks: NoteBlocks = {};
  for (const card of lesson.cards) {
    const open = opened(card.questionId);
    blocks[cardKey(card.questionId, "meaning")] = plain(card.meaning);
    if (open) blocks[cardKey(card.questionId, "sense")] = plain(open.sense);
    if (open) blocks[cardKey(card.questionId, "example")] = plain(open.example.text);
    blocks[cardKey(card.questionId, "sentence")] = cardSentenceRuns(card.drill.sentence);
    if (open) blocks[cardKey(card.questionId, "basis")] = cardBasisRuns(open.basis);
  }
  return blocks;
}

/* ---------- have (scene lesson) ---------- */

export const haveKey = (questionId: string, field: "ask" | "scene" | "source") => `have-${questionId}-${field}`;
export const haveOptionKey = (questionId: string, index: number) => `have-${questionId}-o${index}`;
export const materialKey = (materialId: string, field: "desc") => `mat-${materialId}-${field}`;
export const materialZoneKey = (materialId: string, zone: number, field: "ex" | "ctx" | "lis") => `mat-${materialId}-z${zone}-${field}`;
/** "말하는 사람: … · author", a line break, then the title as a citation. */
export const haveSourceRuns = (who: string, source: PublicLearningCatalog["source"]): NoteRun[] => [{ text: `말하는 사람: ${who} · ${source.author}` }, { gap: "break" }, { text: source.title, wrap: "cite" }];

export function haveBlocks(catalog: PublicLearningCatalog, materials: ReferenceMaterial[]): NoteBlocks {
  const blocks: NoteBlocks = {};
  for (const question of catalog.questions) {
    blocks[haveKey(question.questionId, "ask")] = plain(question.ask);
    blocks[haveKey(question.questionId, "scene")] = plain(question.scene);
    blocks[haveKey(question.questionId, "source")] = haveSourceRuns(question.who, catalog.source);
    question.opts?.forEach((option, index) => { blocks[haveOptionKey(question.questionId, index)] = plain(option.t); });
  }
  for (const material of materials) {
    blocks[materialKey(material.id, "desc")] = plain(material.description);
    material.zones.forEach((zone, index) => {
      blocks[materialZoneKey(material.id, index, "ex")] = plain(zone.ex);
      blocks[materialZoneKey(material.id, index, "ctx")] = plain(zone.ctx);
      blocks[materialZoneKey(material.id, index, "lis")] = plain(zone.lis);
    });
  }
  return blocks;
}
