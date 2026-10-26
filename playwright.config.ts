import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const PORT = 3200;
const dir = path.resolve("tmp/e2e");

/**
 * E2E runs against an isolated database + storage folder with the mock AI
 * provider and the in-app worker, so it costs nothing and never touches dev data.
 * Set PLAYWRIGHT_CHROMIUM_EXECUTABLE to use a preinstalled Chromium.
 */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 180_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    acceptDownloads: true,
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 900 },
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {},
  },
  webServer: {
    command: `npx tsx tests/e2e/prepare.ts && npx next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/api/config`,
    timeout: 180_000,
    reuseExistingServer: false,
    env: {
      DATABASE_URL: `file:${path.join(dir, "e2e.db")}`,
      STORAGE_DIR: path.join(dir, "storage"),
      IMAGE_PROVIDER: "mock",
      MOCK_FAIL_RATE: "0",
      MOCK_DELAY_MS: "200-600",
      ANTHROPIC_API_KEY: "",
      BG_REMOVAL_PROVIDER: "",
      RUN_WORKER_IN_APP: "true",
    },
  },
});
