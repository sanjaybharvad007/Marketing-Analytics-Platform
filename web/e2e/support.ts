import { type BrowserContext, expect, type Page, test as base } from "@playwright/test";
import { baseURL } from "../playwright.config";

export type Theme = "light" | "dark";

/**
 * `test` with a guard on the browser console: any error logged while a test
 * runs, or any uncaught exception in the page, fails that test.
 */
export const test = base.extend<{ consoleErrors: string[] }>({
  consoleErrors: [
    async ({ page }, provide) => {
      const errors: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      page.on("pageerror", (error) => errors.push(String(error)));
      await provide(errors);
      expect(errors, "errors in the browser console").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

/** The app reads its theme from a cookie, so set it before the first request. */
export async function useTheme(context: BrowserContext, theme: Theme): Promise<void> {
  await context.addCookies([{ name: "theme", value: theme, url: baseURL }]);
}

/** True when the document is wider than the viewport, i.e. the page scrolls sideways. */
export async function overflowsHorizontally(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const root = document.documentElement;
    return root.scrollWidth > root.clientWidth + 1;
  });
}

/** Total row count shown by a table's pagination footer ("1–25 of 302"). */
export async function paginationTotal(page: Page): Promise<number> {
  const text = await page.getByRole("navigation", { name: "Pagination" }).locator("p").innerText();
  const match = /of ([\d,]+)/.exec(text);
  if (!match?.[1]) throw new Error(`Unexpected pagination text: ${text}`);
  return Number(match[1].replaceAll(",", ""));
}
