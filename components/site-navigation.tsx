"use client";

import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { LessonListing } from "@/lib/lesson-list";
import { LessonListDialog } from "@/components/lesson-list-dialog";

const NavigationContext = createContext<LessonListing | null>(null);

/** Only public listing summaries cross this boundary. Navigation never owns a lesson record or request. */
export function SiteNavigationProvider({ listing, children }: { listing: LessonListing; children: ReactNode }) {
  return <NavigationContext.Provider value={listing}>{children}</NavigationContext.Provider>;
}

export const senseWords = ["have", "get", "be", "go", "come"] as const;

export function SiteNavigation({ currentList, currentPage }: { currentList?: { href: string; title: string }; currentPage?: string }) {
  const listing = useContext(NavigationContext);
  const [window, setWindow] = useState<"lessons" | "resources" | null>(null);
  const modal = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const heading = useId();
  useEffect(() => {
    if (!window) return;
    trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    modal.current?.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; trigger.current?.focus({ preventScroll: true }); };
  }, [window]);
  // Standalone shell tests may render without the server-provided listing.
  if (!listing) return null;
  const close = () => setWindow(null);
  return <nav className="study-navigation" aria-label="사이트">
    <button type="button" aria-label="수업 목록" aria-haspopup="dialog" onClick={() => setWindow("lessons")}>수업 목록</button>
    <button type="button" aria-label="감각 자료" aria-haspopup="dialog" onClick={() => setWindow("resources")}>감각 자료</button>
    <a href="/ask/" aria-current={currentPage === "ask" ? "page" : undefined}>문장 해설기 <span aria-hidden="true">↗</span></a>
    {window && <dialog className="study-dialog" ref={modal} aria-labelledby={heading} onCancel={event => { event.preventDefault(); close(); }} onKeyDown={event => {
      if (event.key !== "Tab") return;
      const controls = event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), a[href]");
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
      <header><h2 id={heading}>{window === "lessons" ? "수업 목록" : "감각 자료"}</h2><button type="button" onClick={close} aria-label="닫고 학습으로 돌아가기">닫기 <span aria-hidden="true">×</span></button></header>
      <div className="study-dialog-body">{window === "lessons" ? <>
        {currentList && <a className="study-current-list" href={currentList.href}>{currentList.title} <span aria-hidden="true">→</span></a>}
        <LessonListDialog listing={listing} />
      </> : <><p className="lw-dialog-intro">기본동사의 감각 설명과 그림을 읽습니다.</p><ul className="study-resource-links">{senseWords.map(word => <li key={word}><a href={`/${word}/`}><strong lang="en">{word}</strong><span>감각 설명과 예시</span><span aria-hidden="true">→</span></a></li>)}</ul></>}</div>
    </dialog>}
  </nav>;
}
