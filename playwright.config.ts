import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  workers: 2,
  use: { baseURL: process.env.TEST_BASE_URL || "http://127.0.0.1:8787", trace: "retain-on-failure" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" } },
  ],
  webServer: process.env.TEST_BASE_URL ? undefined : {
    command: "npx wrangler dev --ip 127.0.0.1 --port 8787",
    url: "http://127.0.0.1:8787/", reuseExistingServer: !process.env.CI, timeout: 120_000,
  },
});
