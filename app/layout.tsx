import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./workspace.css";
import "./public-pages.css";
import { site } from "@/lib/content";
import { getLessonListing } from "@/lib/server/study-source";
import { SiteNavigationProvider } from "@/components/site-navigation";

export const metadata: Metadata = {
  metadataBase: new URL(site.base),
  title: site.name,
  description: site.tagline,
  icons: { icon: { url: "/assets/icon.svg", type: "image/svg+xml" } },
  twitter: { card: "summary_large_image" },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="ko"><head>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Hahmlet:wght@500;700;800&family=IBM+Plex+Sans+KR:wght@400;500;600&family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,600;1,6..72,400&display=swap" />
  </head><body><a className="skip-link" href="#main-content">본문으로 건너뛰기</a><SiteNavigationProvider listing={getLessonListing()}>{children}</SiteNavigationProvider></body></html>;
}
