"use client";

import { useEffect, useLayoutEffect, useRef } from "react";

type Probe = { element: HTMLElement; top: number };

/** The document section that holds the line just under the sticky toolbar and reference stack, and where it sits in the viewport. */
function sampleProbe(): Probe | null {
  const sections = [...document.querySelectorAll<HTMLElement>(".lw-document-flow [data-outline-id]")];
  if (!sections.length) return null;
  const wide = window.matchMedia("(min-width:1100px)").matches;
  const line = wide ? (document.querySelector<HTMLElement>(".lw-toolbar")?.offsetHeight || 54) + (document.querySelector<HTMLElement>(".lw-reference-stack")?.getBoundingClientRect().height || 0) + 28 : 16;
  let current = sections[0];
  for (const section of sections) if (section.getBoundingClientRect().top <= line + 1) current = section;
  return { element: current, top: current.getBoundingClientRect().top };
}

/**
 * Keeps the reader's place when a request or reply lands in a quiz above the viewport. The answer, the AI feedback and the questions
 * are in the document, so a reply to a quiz the reader has scrolled past would push the page down. When `changeKey` changes, the
 * section at the top of the viewport is put back where it was (a browser that already anchored the scroll needs no correction).
 * Nothing else moves the page: other commits only refresh the remembered place. `enabled` waits for the record to be read.
 */
export function useReadingHold(changeKey: string, enabled: boolean) {
  const probe = useRef<Probe | null>(null), lastKey = useRef(changeKey), armed = useRef(false);
  useEffect(() => {
    const sample = () => { probe.current = sampleProbe(); };
    sample(); window.addEventListener("scroll", sample, { passive: true }); window.addEventListener("resize", sample);
    return () => { window.removeEventListener("scroll", sample); window.removeEventListener("resize", sample); };
  }, []);
  useLayoutEffect(() => {
    const saved = probe.current, changed = lastKey.current !== changeKey;
    lastKey.current = changeKey;
    if (!armed.current) { armed.current = enabled; probe.current = sampleProbe(); return; }
    if (changed && saved?.element.isConnected) {
      const delta = saved.element.getBoundingClientRect().top - saved.top;
      if (Math.abs(delta) >= 1) window.scrollBy({ top: delta, behavior: "instant" });
    }
    probe.current = sampleProbe();
  });
}
