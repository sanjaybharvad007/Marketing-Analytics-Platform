import { defineConfig } from "@playwright/test";
import base from "../playwright.config";

/**
 * Regenerates the screenshots used in the README (docs/images):
 *   npm run build && npm run screenshots
 * Run it against a freshly seeded demo database so the images match the docs.
 */
export default defineConfig({
  ...base,
  testDir: ".",
  testMatch: "readme-screenshots.ts",
  projects: [
    {
      name: "chromium",
      use: { viewport: { width: 1440, height: 960 }, deviceScaleFactor: 2 },
    },
  ],
});
