import { defineConfig, devices } from "@playwright/test";

export const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

/**
 * Browser tests run against a production build with the demo dataset loaded:
 *   npm run build && npm run e2e
 */
export default defineConfig({
  testDir: "e2e",
  testMatch: "*.spec.ts",
  // The specs change shared rows (tasks, plans, saved views), so they run one at a time.
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: {
    command: "npm run start",
    url: `${baseURL}/api/v1/health`,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
