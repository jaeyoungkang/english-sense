import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Breadcrumbs, SiteFooter, SiteHeader } from "@/components/site-shell";
import { SenseStage } from "@/components/sense-stage";
import { Quiz } from "@/components/quiz";
import { Ask } from "@/components/ask";
import { StudyPartView } from "@/components/study-pages";
import LearningWorkspace from "@/components/learning-workspace";
import { getPage, pages, site, type ContentPage } from "@/lib/content";
import { getPublicLearningCatalog } from "@/lib/server/learning-catalog";
import { getPublicReferenceMaterials } from "@/lib/server/reference-materials";

type Props = { params: Promise<{ slug?: string[] }> };
export const dynamicParams = false;
export function generateStaticParams() {
  return pages.map(page => ({ slug: page.path ? page.path.slice(0, -1).split("/") : [] }));
}
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const page = getPage((await params).slug);
  if (!page) return {};
  const url = `${site.base}/${page.path}`;
  const image = { url: `/assets/og/${page.og || "default"}.png`, width: 1200, height: 630 };
  return {
    title: page.title, description: page.description, alternates: { canonical: url },
    openGraph: { type: page.type || "article", locale: "ko_KR", siteName: site.name, title: page.title, description: page.description, url, images: [image] },
    twitter: { card: "summary_large_image", title: page.title, description: page.description, images: [image.url] },
  };
}
function structuredData(page: ContentPage) {
  const items: object[] = [];
  if (page.path === "") items.push({ "@context": "https://schema.org", "@type": "WebSite", name: site.name, url: `${site.base}/`, description: page.description, inLanguage: "ko" });
  else items.push({ "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [[site.name, "/"], ...(page.crumbs || [])].map(([name, href], i) => ({ "@type": "ListItem", position: i + 1, name, ...(href ? { item: site.base + href } : {}) })) });
  if (page.ld === "article") items.push({ "@context": "https://schema.org", "@type": "Article", headline: page.h1 || page.title, description: page.description, inLanguage: "ko", url: `${site.base}/${page.path}`, image: `${site.base}/assets/og/${page.og || "default"}.png`, isPartOf: { "@type": "WebSite", name: site.name, url: `${site.base}/` } });
  return items;
}
export default async function ContentRoute({ params }: Props) {
  const page = getPage((await params).slug);
  if (!page) notFound();
  if (page.path === "") {
    return <LearningWorkspace catalog={await getPublicLearningCatalog()} materials={getPublicReferenceMaterials()} />;
  }
  return <>
    {structuredData(page).map((data, index) => <script key={index} type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }} />)}
    <SiteHeader menu={page.menu} />
    <main className="wrap" id="main-content"><Breadcrumbs page={page} />
      {page.parts.map((part, index) => {
        if (part.kind === "html") return <div className="content-fragment" key={index} dangerouslySetInnerHTML={{ __html: part.html }} />;
        if (part.kind === "stage") return <SenseStage key={index} content={part} />;
        if (part.kind === "quiz") return <Quiz key={index} content={part} />;
        if (part.kind === "ask") return <Ask key={index} />;
        return <StudyPartView key={index} part={part} />;
      })}
    </main><SiteFooter />
  </>;
}
