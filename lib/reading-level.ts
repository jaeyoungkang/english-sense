import { clockLabel } from "./study-content";

/**
 * Reading levels of a story lesson: how many words per minute the time limit allows.
 * The limit is words ÷ pace × 60 seconds, rounded up to 10 seconds. The record keeps the chosen level and the limit it gave,
 * and states facts about the reading (time, pace, how it ended). It never derives a score, mastery or progress.
 */
export type ReadingLevel = "relaxed" | "normal" | "fast";
export const readingLevels: readonly { id: ReadingLevel; label: string; wordsPerMinute: number }[] = [
  { id: "relaxed", label: "여유 있게", wordsPerMinute: 100 },
  { id: "normal", label: "보통", wordsPerMinute: 125 },
  { id: "fast", label: "빠르게", wordsPerMinute: 150 },
];
export const defaultReadingLevel: ReadingLevel = "normal";
export const isReadingLevel = (value: unknown): value is ReadingLevel => readingLevels.some(level => level.id === value);
export const levelOf = (level: ReadingLevel) => readingLevels.find(item => item.id === level)!;

/** Seconds allowed for `words` at this level, in steps of 10 seconds. */
export function levelLimitSeconds(words: number, level: ReadingLevel): number {
  // words × 60 ÷ pace, up to the next 10 seconds. The integer product keeps an exact result exact.
  return Math.ceil(words * 6 / levelOf(level).wordsPerMinute) * 10;
}

/** "분당 약 137낱말". Null when no time passed, because the pace is then undefined. */
export function wordsPerMinuteLabel(words: number, readMs: number): string | null {
  return readMs > 0 && words > 0 ? `분당 약 ${Math.round(words / (readMs / 60000))}낱말` : null;
}

/** The facts of one reading. `level` is absent in a record written before levels existed. */
export type ReadingFacts = { level?: ReadingLevel; readMs: number; by: "time" | "user"; words: number };

/** "수준 보통 · 읽은 시간 3:12 · 분당 약 137낱말 · 직접 끝냄". `withEnd` false leaves the last part out. Only facts; a part that is unknown is left out. */
export function readingFactsLine({ level, readMs, by, words }: ReadingFacts, withEnd = true): string {
  return [level ? `수준 ${levelOf(level).label}` : "", `읽은 시간 ${clockLabel(readMs / 1000)}`, wordsPerMinuteLabel(words, readMs) ?? "", withEnd ? (by === "time" ? "시간 마감" : "직접 끝냄") : ""].filter(Boolean).join(" · ");
}

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const isTime = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;

/** What a list shows next to a story from this browser's record. */
export type StoredReading = { line: string; firstMatches: number | null };

/**
 * Reads one story's stored record for a list, without any of the lesson's own checks: a list only shows what it can read with
 * certainty, so a damaged or unexpected record gives null and the list shows nothing. It never throws and writes nothing.
 * The line states the reading's level, time and pace; `firstMatches` counts the questions whose first answer the server found
 * equal to the canonical one (null while no first answer exists).
 */
export function readStoredReading(raw: string | null, lessonId: string, words: number, now: number): StoredReading | null {
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!isObject(value) || value.version !== 4 || value.lessonId !== lessonId || !Array.isArray(value.events) || !Array.isArray(value.artifacts)) return null;
    const start = value.events.find((event): event is Record<string, unknown> => isObject(event) && event.kind === "reading-start");
    if (!start || !isTime(start.startedAt) || !isTime(start.limitSeconds) || start.limitSeconds < 1) return null;
    const end = value.events.find((event): event is Record<string, unknown> => isObject(event) && event.kind === "reading-end" && event.readingId === start.readingId);
    const deadline = start.startedAt + start.limitSeconds * 1000;
    let endedAt: number, by: "time" | "user";
    if (end) {
      if (!isTime(end.endedAt) || end.endedAt < start.startedAt || (end.by !== "time" && end.by !== "user")) return null;
      endedAt = end.endedAt; by = end.by;
    } else if (now >= deadline) { endedAt = deadline; by = "time"; }
    else return null;
    const level = isReadingLevel(start.level) ? start.level : undefined;
    let firstMatches: number | null = null;
    for (const artifact of value.artifacts) {
      const first = isObject(artifact) && Array.isArray(artifact.attempts) ? artifact.attempts[0] : undefined;
      if (!isObject(first)) continue;
      firstMatches = (firstMatches ?? 0) + (isObject(first.check) && first.check.kind === "choose" && first.check.match === true ? 1 : 0);
    }
    return { line: readingFactsLine({ level, readMs: endedAt - start.startedAt, by, words }, false), firstMatches };
  } catch { return null; }
}

/** "이 브라우저의 기록 · 수준 보통 · 읽은 시간 3:12 · 분당 약 137낱말 · 정본과 같은 첫 답 5개". Null when there is no record. */
export function storedReadingText(reading: StoredReading | null): string | null {
  return reading ? ["이 브라우저의 기록", reading.line, reading.firstMatches === null ? "" : `정본과 같은 첫 답 ${reading.firstMatches}개`].filter(Boolean).join(" · ") : null;
}
