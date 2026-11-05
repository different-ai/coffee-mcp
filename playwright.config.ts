import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "ui",
  timeout: 60000,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:8790",
    viewport: { width: 1280, height: 900 },
    screenshot: "only-on-failure",
    launchOptions: {
      executablePath: process.env.COFFEE_CHROME_PATH,
      args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
    },
  },
  webServer: {
    command: "pnpm build:app && pnpm exec wrangler dev --port 8790",
    // /sf content-negotiates MCP; Playwright's readiness probe doesn't send text/html.
    url: "http://127.0.0.1:8790/sf/confirm",
    reuseExistingServer: !process.env.CI,
    timeout: 60000,
  },
});
