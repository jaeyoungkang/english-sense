import { site, type ContentPage } from "@/lib/content";
import { SiteNavigation } from "@/components/site-navigation";

export function SiteHeader({ menu }: { menu?: string }) {
  return <header className="top"><div className="top-in">
    <a className="brand" href="/" aria-label="영어 감각 홈"><span className="public-mark" aria-hidden="true">e.</span>{site.name}</a>
    <SiteNavigation currentPage={menu} />
  </div></header>;
}

export function SiteOutline({ menu }: { menu?: string }) {
  return <aside className="public-outline"><p className="public-outline-label">ENGLISH SENSE</p><h2>학습 찾아보기</h2>
    <nav aria-label="학습 분류"><a href="/">학습 노트 <span aria-hidden="true">↗</span></a>{[["practice", "/practice/", "장면 연습"], ["reading", "/reading/", "이야기 읽기"], ["prep", "/prep/", "책·영화 사전 훈련"], ["ask", "/ask/", "문장 해설기"]].map(([key, href, title]) => <a href={href} key={key} aria-current={key === menu ? "page" : undefined}>{title}</a>)}</nav>
  </aside>;
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
