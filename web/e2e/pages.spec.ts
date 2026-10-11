import { expect, overflowsHorizontally, test, type Theme, useTheme } from "./support";

const PAGES = [
  { path: "/", link: "Overview", heading: "Overview" },
  { path: "/reports/seo", link: "SEO", heading: "SEO report" },
  { path: "/reports/ai-visibility", link: "AI visibility", heading: "AI visibility" },
  { path: "/planner", link: "Planner", heading: "Planner" },
  { path: "/work", link: "Work", heading: "Work" },
  { path: "/audits", link: "Audits", heading: "Audits" },
  { path: "/pipelines", link: "Pipelines", heading: "Pipelines" },
];
const THEMES: Theme[] = ["light", "dark"];

for (const theme of THEMES) {
  for (const { path, heading } of PAGES) {
    test(`${path} renders in the ${theme} theme`, async ({ page, context }, testInfo) => {
      await useTheme(context, theme);
      const response = await page.goto(path, { waitUntil: "networkidle" });

      expect(response?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(page.getByText("Demo data")).toBeVisible();
      expect(await overflowsHorizontally(page)).toBe(false);

      await page.screenshot({
        path: testInfo.outputPath(`${heading.toLowerCase().replaceAll(" ", "-")}-${theme}.png`),
        fullPage: true,
      });
    });
  }
}

test("pages fit a phone-sized viewport without scrolling sideways", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const { path, heading } of PAGES) {
    await page.goto(path, { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    expect(await overflowsHorizontally(page), `${path} overflows`).toBe(false);
  }
});

test("the theme toggle switches theme and the choice survives a reload", async ({
  page,
  context,
}) => {
  await useTheme(context, "light");
  await page.goto("/");
  await page.getByRole("button", { name: "Switch to dark theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("button", { name: "Switch to light theme" })).toBeVisible();
});

test("an unknown address shows the not-found page", async ({ page, consoleErrors }) => {
  const response = await page.goto("/no-such-page");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("not on the map");
  // The browser logs the 404 response itself; that entry is expected here.
  consoleErrors.length = 0;
});

test("the sidebar links reach every section", async ({ page }) => {
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Main" });
  for (const { path, link, heading } of PAGES.slice(1)) {
    await nav.getByRole("link", { name: link, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
  }
});
