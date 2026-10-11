import { expect, test } from "./support";

test.describe("AI visibility report", () => {
  test("engine and gap filters update the URL and the prompt table", async ({ page }) => {
    await page.goto("/reports/ai-visibility");
    const prompts = page.getByRole("table").filter({ hasText: "Most-named competitor" });
    const all = await prompts.locator("tbody tr").count();
    expect(all).toBeGreaterThan(10);

    await page.getByRole("button", { name: /^Engine/ }).click();
    await page.getByRole("checkbox", { name: "Perplexity" }).check();
    await expect(page).toHaveURL(/engine=perplexity/);
    await page.keyboard.press("Escape");
    await expect(prompts.getByRole("columnheader", { name: "Perplexity" })).toBeVisible();
    await expect(prompts.getByRole("columnheader", { name: "ChatGPT" })).toHaveCount(0);

    await page.getByRole("radio", { name: "Gaps only" }).click();
    await expect(page).toHaveURL(/show=gaps/);
    await expect.poll(() => prompts.locator("tbody tr").count()).toBeLessThan(all);
    const rows = await prompts.locator("tbody tr td:first-child").allInnerTexts();
    for (const row of rows) expect(row).toContain("Gap");
  });

  test("a prompt opens its stored answers", async ({ page }) => {
    await page.goto("/reports/ai-visibility");
    const link = page
      .getByRole("table")
      .filter({ hasText: "Most-named competitor" })
      .locator("tbody tr td:first-child a")
      .first();
    const prompt = await link.innerText();
    await link.click();

    await expect(page).toHaveURL(/prompt=\d+/);
    const panel = page.getByRole("dialog", { name: prompt });
    await expect(panel.getByRole("heading", { level: 3 }).first()).toBeVisible();

    await panel.getByRole("button", { name: "Close" }).click();
    await expect(page).not.toHaveURL(/prompt=/);
    await expect(panel).toBeHidden();
  });
});

test.describe("Overview", () => {
  test("the date range changes the period and the trend has a table view", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /^Last 28 days/ }).click();
    await page.getByRole("button", { name: "Last 90 days" }).click();
    await expect(page).toHaveURL(/range=90d/);
    await expect(page.getByRole("button", { name: /^Last 90 days/ })).toBeVisible();

    await page.getByRole("button", { name: "Table", exact: true }).first().click();
    const asTable = page.getByRole("button", { name: "Chart", exact: true }).first();
    await expect(asTable).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("columnheader", { name: "Date" }).first()).toBeVisible();
  });
});

test.describe("Audits", () => {
  test("issues filter by severity and can be ignored and reopened", async ({ page }) => {
    await page.goto("/audits");
    const filters = page.getByRole("search", { name: "Issue filters" });
    await filters.getByLabel("Severity").selectOption("medium");
    await expect(page).toHaveURL(/severity=medium/);
    const issues = page.getByRole("table").filter({ hasText: "Severity" });
    await expect.poll(() => issues.locator("tbody tr").count()).toBeGreaterThan(0);
    for (const text of await issues.locator("tbody tr td:first-child").allInnerTexts()) {
      expect(text).toContain("Medium");
    }

    // Rows are identified by rule and page, which together are unique within a run.
    const openRow = issues
      .locator("tbody tr")
      .filter({ has: page.getByRole("button", { name: "Ignore" }) })
      .first();
    const rule = await openRow.locator("td").nth(1).locator("span").first().innerText();
    const path = await openRow.locator("td").nth(2).innerText();
    const row = issues.locator("tbody tr").filter({ hasText: rule }).filter({ hasText: path });

    await openRow.getByRole("button", { name: "Ignore" }).click();
    await expect(row.getByRole("button", { name: "Reopen" })).toBeVisible();
    await expect(row).toContainText("Ignored");

    await row.getByRole("button", { name: "Reopen" }).click();
    await expect(row.getByRole("button", { name: "Ignore" })).toBeVisible();
  });
});
