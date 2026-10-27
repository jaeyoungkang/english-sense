"use client";

import { useEffect, useState } from "react";
import { LESSON_STORAGE_PREFIX } from "@/lib/lesson-record-key";
import { readStoredReading, storedReadingText } from "@/lib/reading-level";

/**
 * What this browser remembers of one story, beside the story in a list: level, reading time, pace and how many first answers equal
 * the canonical one. It is a small client island because the lists are prerendered pages. Nothing is drawn until the browser's
 * record has been read, and nothing is drawn when there is none, when it cannot be read or when it is not one this app wrote.
 * It only reads; it never writes the record or calls the server.
 */
export function StoryRecordNote({ storyId, words, className }: { storyId: string; words: number; className?: string }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    try { setText(storedReadingText(readStoredReading(localStorage.getItem(`${LESSON_STORAGE_PREFIX}${storyId}`), storyId, words, Date.now()))); }
    catch { setText(null); }
  }, [storyId, words]);
  return text ? <span className={className ?? "lw-record-note"} data-story-record={storyId}>{text}</span> : null;
}
