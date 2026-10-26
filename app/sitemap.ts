import type { MetadataRoute } from "next";
import { pages, site } from "@/lib/content";

export default function sitemap(): MetadataRoute.Sitemap {
  return pages.map((page) => ({ url: `${site.base}/${page.path}` }));
}
