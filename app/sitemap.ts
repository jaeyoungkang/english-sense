import type { MetadataRoute } from "next";
import { site } from "@/lib/content";
import { pages } from "@/lib/server/site-pages";

export default function sitemap(): MetadataRoute.Sitemap {
  return pages.map((page) => ({ url: `${site.base}/${page.path}` }));
}
