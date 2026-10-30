"use client";

import { useEffect, useState } from "react";
import { LESSON_STORAGE_PREFIX } from "@/lib/lesson-record-key";
import { readStoredReading, storedReadingText } from "@/lib/reading-level";
import { getStoryPublicGuide } from "@/lib/story-lesson";
import type { ReadingSummaryStory } from "@/lib/study-content-types";

type ActiveStoryItem = {
  id: string;
  title: string;
  subtitleKo?: string;
  summary: string;
};

/**
 * 홈의 '이야기 읽기 메인 허브'에서 이 브라우저에 읽거나 풀던 이야기 기록이 있으면
 * 바로 이어서 열 수 있게 보여 주는 읽기 전용 클라이언트 배너.
 * localStorage를 읽기만 하며 어떤 키도 새로 쓰지 않고 API 요청도 보내지 않는다.
 */
export function ContinueReadingBanner({ stories }: { stories: ReadingSummaryStory[] }) {
  const [items, setItems] = useState<ActiveStoryItem[]>([]);

  useEffect(() => {
    try {
      const now = Date.now();
      const found: ActiveStoryItem[] = [];
      for (const story of stories) {
        const raw = localStorage.getItem(`${LESSON_STORAGE_PREFIX}${story.id}`);
        const summary = storedReadingText(readStoredReading(raw, story.id, story.words, now));
        if (summary) {
          const guide = getStoryPublicGuide(story.id);
          found.push({
            id: story.id,
            title: story.title,
            subtitleKo: guide?.subtitleKo,
            summary,
          });
        }
      }
      setItems(found);
    } catch {
      setItems([]);
    }
  }, [stories]);

  if (items.length === 0) return null;

  return (
    <section className="continue-reading-box" aria-labelledby="continue-reading-h">
      <h2 id="continue-reading-h">읽던 이야기 이어 보기</h2>
      <p className="muted">이 브라우저에서 읽거나 문제를 풀던 이야기입니다. 누르면 멈춘 자리에서 바로 이어서 봅니다.</p>
      <div className="links">
        {items.map(item => (
          <a className="link-card" key={item.id} href={`/reading/${item.id}/`}>
            <span className="t">
              <span className="en">{item.title}</span>
              {item.subtitleKo ? ` · ${item.subtitleKo}` : ""}
            </span>
            <span className="s">{item.summary}</span>
          </a>
        ))}
      </div>
    </section>
  );
}
