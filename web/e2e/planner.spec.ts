import { expect, test } from "./support";

test("a plan can be created, edited and deleted", async ({ page }) => {
  const title = `E2E plan ${Date.now()}`;
  await page.goto("/planner");

  await page.getByRole("button", { name: "New plan" }).click();
  const dialog = page.getByRole("dialog", { name: "New plan" });

  // Validation: a title is required.
  await dialog.getByRole("button", { name: "Create plan" }).click();
  await expect(dialog.getByLabel("Title")).toHaveAttribute("aria-invalid", "true");

  await dialog.getByLabel("Title").fill(title);
  await dialog.getByLabel("Target keyword").fill("trail running shoes");
  await dialog.getByLabel("Page type").selectOption("guide");
  await dialog.getByLabel("Priority").selectOption("high");
  await dialog.getByRole("button", { name: "Create plan" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Plan created" })).toBeVisible();
  await expect(dialog).toBeHidden();

  const row = page.getByRole("row").filter({ hasText: title });
  await expect(row).toBeVisible();
  await expect(row).toContainText("High");

  await page.getByRole("button", { name: `Edit ${title}` }).click();
  const editing = page.getByRole("dialog", { name: "Edit plan" });
  await editing.getByLabel("Status").selectOption("draft");
  await editing.getByLabel("Notes").fill("Compare cushioning and lug depth.");
  await editing.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Plan saved" })).toBeVisible();

  // The change is stored, not only shown.
  await page.reload();
  const saved = page.getByRole("row").filter({ hasText: title });
  await expect(saved).toContainText("Draft");

  // The pipeline layout shows the plan in its status column.
  await page.getByRole("radio", { name: "Pipeline" }).click();
  await expect(page).toHaveURL(/view=pipeline/);
  await expect(page.getByRole("region", { name: /^Draft/ })).toContainText(title);
  await page.getByRole("radio", { name: "Table" }).click();

  page.once("dialog", (confirm) => void confirm.accept());
  await page.getByRole("button", { name: `Edit ${title}` }).click();
  await page
    .getByRole("dialog", { name: "Edit plan" })
    .getByRole("button", { name: "Delete plan" })
    .click();
  await expect(page.getByRole("status").filter({ hasText: "Plan deleted" })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: title })).toHaveCount(0);
});

test("plan filters narrow the list and are kept in the URL", async ({ page }) => {
  await page.goto("/planner");
  const all = await page.locator("tbody tr").count();

  const filters = page.getByRole("search", { name: "Plan filters" });
  await filters.getByLabel("Status").selectOption("published");
  await expect(page).toHaveURL(/status=published/);
  await expect.poll(() => page.locator("tbody tr").count()).toBeLessThan(all);
  for (const text of await page.locator("tbody tr td:nth-child(2)").allInnerTexts()) {
    expect(text).toContain("Published");
  }
});
