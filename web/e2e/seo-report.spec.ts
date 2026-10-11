import { readFile } from "node:fs/promises";
import { expect, paginationTotal, test } from "./support";

test.describe("SEO report", () => {
  test("filters are stored in the URL and narrow the table", async ({ page }) => {
    await page.goto("/reports/seo");
    const unfiltered = await paginationTotal(page);

    await page.getByRole("button", { name: /^Country/ }).click();
    await page.getByRole("checkbox", { name: "United Kingdom" }).check();
    await expect(page).toHaveURL(/country=GB/);
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: /^Device/ }).click();
    await page.getByRole("checkbox", { name: "Mobile" }).check();
    await expect(page).toHaveURL(/device=mobile/);
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: /^Position/ }).click();
    await page.getByRole("checkbox", { name: "11-20" }).check();
    await expect(page).toHaveURL(/position=11-20/);
    await page.keyboard.press("Escape");

    await page.getByRole("radio", { name: "Non-brand" }).click();
    await expect(page).toHaveURL(/brand=non_brand/);

    await page.getByRole("button", { name: /^More filters/ }).click();
    await page.getByLabel("Min. impressions").fill("50");
    await page.getByRole("button", { name: "Apply filters" }).click();
    await expect(page).toHaveURL(/min_impressions=50/);

    const chips = page.getByLabel("Active filters");
    await expect(chips.getByText("United Kingdom")).toBeVisible();
    await expect(chips.getByText("Mobile")).toBeVisible();
    await expect.poll(() => paginationTotal(page)).toBeLessThan(unfiltered);
    const filtered = await paginationTotal(page);
    expect(filtered).toBeGreaterThan(0);

    // Every remaining row sits in the chosen position bucket: above 10, up to 20.
    const positions = await page.locator("tbody tr td:last-child").allInnerTexts();
    expect(positions.length).toBeGreaterThan(0);
    for (const text of positions) {
      const position = Number.parseFloat(text);
      expect(position).toBeGreaterThanOrEqual(10);
      expect(position).toBeLessThanOrEqual(20);
    }

    // Back and forward move through the filter history.
    await page.goBack();
    await expect(page).not.toHaveURL(/min_impressions/);
    await expect(page).toHaveURL(/brand=non_brand/);
    await page.goForward();
    await expect(page).toHaveURL(/min_impressions=50/);

    // Removing one chip keeps the others; "Clear all" removes the rest.
    await chips.getByRole("button", { name: /^Remove filter: .*Mobile/ }).click();
    await expect(page).not.toHaveURL(/device=/);
    await expect(page).toHaveURL(/country=GB/);
    await chips.getByRole("button", { name: "Clear all" }).click();
    await expect(page).not.toHaveURL(/country=|position=|brand=|min_impressions=/);
    await expect.poll(() => paginationTotal(page)).toBe(unfiltered);
  });

  test("a shared URL restores the same filters", async ({ page }) => {
    await page.goto(
      "/reports/seo?range=90d&country=US,CA&section=guides&position=4-10&q=sleeping&sort=impressions&dir=asc",
    );
    await expect(page.getByRole("button", { name: /^Country/ })).toContainText(
      "United States, Canada",
    );
    await expect(page.getByRole("button", { name: /^Section/ })).toContainText("Guides");
    await expect(page.getByRole("button", { name: /^More filters/ })).toContainText("1");
    await expect(page.getByRole("columnheader", { name: "Impressions" })).toHaveAttribute(
      "aria-sort",
      "ascending",
    );
    const queries = await page.locator("tbody tr td:first-child").allInnerTexts();
    expect(queries.length).toBeGreaterThan(0);
    for (const query of queries) expect(query.toLowerCase()).toContain("sleeping");
  });

  test("sorting and pagination happen on the server", async ({ page }) => {
    await page.goto("/reports/seo");
    await page.getByRole("columnheader", { name: "Impressions" }).getByRole("link").click();
    await expect(page).toHaveURL(/sort=impressions/);
    const impressions = (await page.locator("tbody tr td:nth-child(3)").allInnerTexts()).map(
      (text) => Number((text.split("\n")[0] ?? "").replaceAll(",", "")),
    );
    expect(impressions).toEqual([...impressions].sort((a, b) => b - a));

    const firstOnPageOne = await page.locator("tbody tr td:first-child").first().innerText();
    await page
      .getByRole("navigation", { name: "Pagination" })
      .getByRole("link", { name: "Next" })
      .click();
    await expect(page).toHaveURL(/page=2/);
    await expect(page.locator("tbody tr td:first-child").first()).not.toHaveText(firstOnPageOne);
  });

  test("tabs switch the table and a row drills into its pages", async ({ page }) => {
    await page.goto("/reports/seo");
    const views = page.getByRole("navigation", { name: "Report views" });

    await views.getByRole("link", { name: "Keywords" }).click();
    await expect(page).toHaveURL(/tab=keywords/);
    await expect(page.getByRole("columnheader", { name: "Difficulty" })).toBeVisible();

    await views.getByRole("link", { name: "Queries" }).click();
    await expect(page.getByRole("columnheader", { name: "Query" })).toBeVisible();
    const firstQuery = page.locator("tbody tr td:first-child a").first();
    const query = await firstQuery.innerText();
    await firstQuery.click();
    await expect(page).toHaveURL(/tab=pages/);
    await expect(page).toHaveURL(
      new RegExp(`query=${encodeURIComponent(query).replaceAll("%20", "(\\+|%20)")}`),
    );
    await expect(page.getByLabel("Active filters").getByText(query)).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Page", exact: true })).toBeVisible();
  });

  test("a saved view can be saved, loaded and deleted", async ({ page }) => {
    const name = `E2E view ${Date.now()}`;
    await page.goto("/reports/seo?country=GB&device=mobile&position=11-20");

    await page.getByRole("button", { name: /^Saved views/ }).click();
    await page.getByLabel("Save current filters as").fill(name);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      page.getByRole("status").filter({ hasText: `Saved view "${name}"` }),
    ).toBeVisible();
    await page.keyboard.press("Escape");

    // Start from a clean report, then load the view.
    await page.goto("/reports/seo");
    await page.getByRole("button", { name: /^Saved views/ }).click();
    await page
      .getByRole("list", { name: "Saved views" })
      .getByRole("button", { name, exact: true })
      .click();
    await expect(page).toHaveURL(/country=GB/);
    await expect(page).toHaveURL(/device=mobile/);
    await expect(page).toHaveURL(/position=11-20/);

    await page.getByRole("button", { name: /^Saved views/ }).click();
    await page.getByRole("button", { name: `Delete view ${name}` }).click();
    await expect(
      page.getByRole("status").filter({ hasText: `Deleted view "${name}"` }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
  });

  test("the CSV export downloads the filtered rows", async ({ page }) => {
    await page.goto("/reports/seo?q=tent&brand=non_brand");
    const total = await paginationTotal(page);

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId("export-csv").click(),
    ]);
    expect(download.suggestedFilename()).toMatch(
      /^seo-queries-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}\.csv$/,
    );

    const lines = (await readFile(await download.path(), "utf8")).trim().split("\r\n");
    expect(lines[0]).toContain("query,clicks,impressions,ctr,position");
    // The export carries every matching row, not only the visible page.
    expect(lines.length - 1).toBe(total);
    for (const line of lines.slice(1)) expect(line.toLowerCase()).toContain("tent");
  });
});
