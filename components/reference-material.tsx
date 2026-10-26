"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { ReferenceMaterial, ReferenceZone } from "@/lib/reference-materials";

function SenseDrawing({ material, zone }: { material: ReferenceMaterial; zone: ReferenceZone }) {
  const instance = useId().replace(/:/g, "");
  const titleId = `sense-title-${instance}`, arrowId = `sense-arrow-${instance}`;
  const moving = material.id === "get" || material.id === "go";
  return <svg viewBox="0 0 310 190" role="img" aria-labelledby={titleId}><title id={titleId}>{material.title} — {material.sense} · {zone.k}</title>{moving && <defs><marker id={arrowId} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10z" fill="currentColor" /></marker></defs>}
    {material.id === "have" && <><ellipse cx="155" cy="91" rx="113" ry="75" fill="#eef0e9" stroke="#69735f" strokeDasharray="5 5" /><circle cx="135" cy="103" r="22" fill="#65715a" /><text x="135" y="109" textAnchor="middle" fill="white" fontSize="17">{zone.subj || "I"}</text><rect x="119" y="36" width="112" height="30" rx="3" fill="white" stroke="#8b9382" /><text x="175" y="56" textAnchor="middle" fill="#384331" fontSize="14">{zone.item || "something"}</text></>}
    {material.id === "get" && <><circle cx="204" cy="90" r="68" fill="#eef0e9" stroke="#69735f" strokeDasharray="5 5" /><circle cx="57" cy="90" r="22" fill="#65715a" /><text x="57" y="96" textAnchor="middle" fill="white" fontSize="15">{zone.a}</text><path d="M85 90H148" stroke="currentColor" strokeWidth="2" markerEnd={`url(#${arrowId})`} /><text x="206" y="96" textAnchor="middle" fill="#384331" fontSize="15">{zone.b}</text></>}
    {material.id === "be" && <><rect x="40" y="22" width="230" height="127" rx="8" fill="#eef0e9" stroke="#69735f" strokeDasharray="5 5" /><text x="155" y="51" textAnchor="middle" fill="#384331" fontSize="16">{zone.b}</text><circle cx="155" cy="99" r="23" fill="#65715a" /><text x="155" y="105" textAnchor="middle" fill="white" fontSize="15">{zone.a}</text></>}
    {material.id === "go" && <><circle cx="81" cy="90" r="55" fill="#eef0e9" stroke="#69735f" strokeDasharray="5 5" /><text x="81" y="96" textAnchor="middle" fill="#384331" fontSize="12">기준점</text><path d="M141 90H228" stroke="currentColor" strokeWidth="2" markerEnd={`url(#${arrowId})`} /><text x="187" y="72" textAnchor="middle" fill="#384331" fontSize="14">{zone.b}</text><circle cx="258" cy="90" r="22" fill="#65715a" /><text x="258" y="96" textAnchor="middle" fill="white" fontSize="15">{zone.a}</text></>}
    <text x="155" y="181" textAnchor="middle" fill="#59644f" fontSize="12">{zone.k}</text></svg>;
}
export function ReferenceMaterialContent({ material, compact = false }: { material: ReferenceMaterial; compact?: boolean }) {
  const [failed, setFailed] = useState(false);
  const image = useRef<HTMLImageElement>(null);
  const zone = material.zones[0];
  useEffect(() => { if (image.current?.complete && image.current.naturalWidth === 0) setFailed(true); }, []);
  return <div className={`lw-material-content ${compact ? "lw-material-compact" : ""}`}><figure className="lw-sense-image">{material.image && !failed ? <img ref={image} src={material.image.src} alt={material.image.alt} onError={() => setFailed(true)} /> : <div className={material.image ? "lw-image-fallback" : "lw-material-diagram"}>{zone && <SenseDrawing material={material} zone={zone} />}{material.image && <p>이미지 대신 감각 도식을 표시합니다.</p>}</div>}<figcaption>{material.id} 감각 · 학습용 도해</figcaption></figure><div className="lw-material-explanation"><p>{material.description}</p>{!compact && <section className="lw-material-detail lw-continuous-examples" aria-label={`${material.id} 감각 예시 전체`}><h3>감각의 쓰임</h3>{material.zones.map(item => <article className="lw-material-example" key={item.k}><h4>{item.k}</h4><p lang="en">{item.ex}</p><dl><dt>장면</dt><dd>{item.ctx}</dd><dt>듣는 사람은</dt><dd>{item.lis}</dd></dl></article>)}<a href={material.href} target="_blank" rel="noopener">공개 감각 설명 전체 읽기 ↗<span className="lw-sr-only">새 창</span></a></section>}</div></div>;
}
