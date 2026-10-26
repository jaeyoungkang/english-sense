import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

if (process.env.NODE_ENV === "development") initOpenNextCloudflareForDev();

const nextConfig: NextConfig = {
  trailingSlash: true,
  poweredByHeader: false,
  async redirects() {
    return ["have", "get", "be", "ask"].map((word) => ({
      source: `/${word}.html`, destination: `/${word}/`, permanent: true,
    }));
  },
};
export default nextConfig;
