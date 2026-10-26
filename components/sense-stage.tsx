"use client";

import { useState } from "react";
import type { StageContent, Zone } from "@/lib/content";

function SceneDiagram({ word, zone }: { word: StageContent["word"]; zone: Zone }) {
  const title = { have: "주어와 그 영역 안에 놓인 것", get: "경계 밖에서 안으로 들어서는 그림", be: "주어가 장소나 모습 안에 놓여 있는 그림", go: "기준점에서 바깥으로 멀어지는 그림" }[word];
  const arrowId = `sense-arrow-${word}`;
  const itemWidth = Math.max(80, (zone.item?.length || 0) * 7.6 + 28);
  return <svg viewBox="0 0 260 220" role="img" aria-labelledby={`zone-svg-${word}`}>
    <title id={`zone-svg-${word}`}>{title}</title>
    {(word === "get" || word === "go") && <defs><marker id={arrowId} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="var(--accent)" /></marker></defs>}
    {word === "have" && <>
      <circle cx="130" cy="110" r="98" fill="var(--zone)" stroke="var(--accent)" strokeWidth="2" strokeDasharray="6 6" />
      <circle cx="130" cy="110" r="26" fill="var(--accent)" />
      <text x="130" y="116" textAnchor="middle" fontFamily="Newsreader, Georgia, serif" fontSize="18" fontWeight="600" fill="var(--on-accent)">{zone.subj}</text>
      <g className="zone-item"><rect x={130 - itemWidth / 2} y="36" width={itemWidth} height="30" rx="15" fill="var(--surface)" stroke="var(--accent)" strokeWidth="1.5" />
        <text x="130" y="56" textAnchor="middle" fontFamily="Newsreader, Georgia, serif" fontSize="14" fill="var(--fg)">{zone.item}</text></g>
    </>}
    {word === "get" && <>
      <circle cx="160" cy="110" r="78" fill="var(--zone)" stroke="var(--accent)" strokeWidth="2" strokeDasharray="6 6" />
      <text x="172" y="114" textAnchor="middle" fontFamily="Newsreader, Georgia, serif" fontSize="15" fill="var(--fg)">{zone.b}</text>
      <circle cx="34" cy="110" r="22" fill="var(--accent)" />
      <text x="34" y="115" textAnchor="middle" fontFamily="Newsreader, Georgia, serif" fontSize="14" fontWeight="600" fill="var(--on-accent)">{zone.a}</text>
      <path d="M60 110 L104 110" stroke="var(--accent)" strokeWidth="2.5" markerEnd={`url(#${arrowId})`} />
    </>}
    {word === "be" && <>
      <rect x="22" y="28" width="216" height="150" rx="16" fill="var(--zone)" stroke="var(--accent)" strokeWidth="2" strokeDasharray="6 6" />
      <text x="130" y="54" textAnchor="middle" fontFamily="Newsreader, Georgia, serif" fontSize="16" fill="var(--accent)">{zone.b}</text>
      <circle cx="130" cy="116" r="26" fill="var(--accent)" />
      <text x="130" y="121" textAnchor="middle" fontFamily="Newsreader, Georgia, serif" fontSize="15" fontWeight="600" fill="var(--on-accent)">{zone.a}</text>
    </>}
    {word === "go" && <>
      <circle cx="78" cy="110" r="58" fill="var(--zone)" stroke="var(--accent)" strokeWidth="2" strokeDasharray="6 6" />
      <text x="78" y="114" textAnchor="middle" fontFamily="IBM Plex Sans KR, sans-serif" fontSize="12" fill="var(--muted)">기준점</text>
      <path d="M140 110 L190 110" stroke="var(--accent)" strokeWidth="2.5" markerEnd={`url(#${arrowId})`} />
      <text x="165" y="96" textAnchor="middle" fontFamily="Newsreader, Georgia, serif" fontSize="15" fill="var(--fg)">{zone.b}</text>
      <circle cx="222" cy="110" r="24" fill="var(--accent)" />
      <text x="222" y="115" textAnchor="middle" fontFamily="Newsreader, Georgia, serif" fontSize="13" fontWeight="600" fill="var(--on-accent)">{zone.a}</text>
    </>}
    <text x="130" y={word === "have" ? 196 : word === "get" ? 208 : 204} textAnchor="middle" fontFamily="IBM Plex Sans KR, sans-serif" fontSize="12" fill="var(--muted)">{word === "have" ? "영역: " : ""}{zone.k}</text>
  </svg>;
}

export function SenseStage({ content }: { content: StageContent }) {
  const [selected, setSelected] = useState(0);
  const zone = content.zones[selected];
  return <section aria-labelledby="zones-h"><h2 id="zones-h">{content.heading}</h2><p className="muted">{content.description}</p>
    <div className="stage"><div className="chips" id="chips" role="group" aria-label={content.word === "have" ? "영역 고르기" : "쓰임 고르기"}>
      {content.zones.map((z, index) => <button key={z.k} id={`zone-${index}`} className="chip" type="button" aria-pressed={selected === index} onClick={() => setSelected(index)}>{z.k}</button>)}
    </div><div className="stage-body"><SceneDiagram word={content.word} zone={zone} />
      <div className="stage-text" aria-live="polite" aria-atomic="true"><p className="big" id="z-ex">{zone.ex}</p><dl className="kv"><dt>장면</dt><dd id="z-ctx">{zone.ctx}</dd><dt>듣는 사람은</dt><dd id="z-lis">{zone.lis}</dd></dl></div>
    </div></div>
  </section>;
}
