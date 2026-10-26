import { site, type ContentPage } from "@/lib/content";

export function SiteHeader({ menu }: { menu?: string }) {
  return <header className="top"><div className="top-in">
    <a className="brand" href="/"><span className="brand-mark" aria-hidden="true" />{site.name}</a>
    <nav className="menu" aria-label="사이트">
      {[["words", "/#words", "표제어"], ["practice", "/practice/", "연습"], ["ask", "/ask/", "해설기"]].map(([key, href, label]) =>
        <a key={key} href={href} aria-current={menu === key ? "page" : undefined}>{label}</a>)}
    </nav>
  </div></header>;
}

export function Breadcrumbs({ page }: { page: ContentPage }) {
  if (!page.crumbs?.length) return null;
  const trail: [string, string | null][] = [[site.name, "/"], ...page.crumbs];
  return <ol className="crumbs" aria-label="이동 경로">{trail.map(([label, href], i) =>
    <li key={i} aria-current={href ? undefined : "page"}>{href ? <a href={href}>{label}</a> : label}</li>)}
  </ol>;
}

export function SiteFooter() {
  return <footer className="foot">
    <p>감각을 이미지, 뉘앙스, 예시 셋으로 보는 틀은 공간 인지 언어학(Tyler &amp; Evans, Talmy)과 한국인 학습자 연구를 바탕으로 정리한 학습 가설입니다.</p>
    <p><a href="/">{site.name}</a> · {site.tagline}</p>
  </footer>;
}
