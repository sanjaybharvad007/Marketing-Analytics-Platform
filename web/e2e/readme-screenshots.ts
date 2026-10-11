import path from "node:path";
import type { Page } from "@playwright/test";
import { test, type Theme, useTheme } from "./support";

// npm runs this from web/, so the images land in the repository's docs folder.
const OUTPUT_DIR = path.resolve(process.cwd(), "..", "docs", "images");

const SHOTS: Array<{
  file: string;
  path: string;
  theme?: Theme;
  prepare?: (page: Page) => Promise<void>;
}> = [
  { file: "overview.png", path: "/" },
  { file: "overview-dark.png", path: "/", theme: "dark" },
  {
    file: "seo-report.png",
    path: "/reports/seo?country=US,GB&device=mobile&position=11-20&brand=non_brand&min_impressions=200",
  },
  { file: "ai-visibility.png", path: "/reports/ai-visibility" },
  { file: "planner.png", path: "/planner" },
  {
    file: "planner-brief.png",
    path: "/planner",
    prepare: async (page) => {
      await page.getByRole("button", { name: "View brief" }).first().click();
      await page.getByRole("dialog").waitFor();
    },
  },
  { file: "board.png", path: "/work" },
  { file: "audits.png", path: "/audits" },
  { file: "pipelines.png", path: "/pipelines" },
];

for (const shot of SHOTS) {
  test(`capture ${shot.file}`, async ({ page, context }) => {
    await useTheme(context, shot.theme ?? "light");
    await page.goto(shot.path, { waitUntil: "networkidle" });
    await shot.prepare?.(page);
    // Let chart and panel entrance animations finish.
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(OUTPUT_DIR, shot.file) });
  });
}
