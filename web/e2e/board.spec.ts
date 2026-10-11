import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./support";

/** Drag with real pointer events; dnd-kit ignores synthetic drag-and-drop. */
async function drag(page: Page, card: Locator, target: Locator): Promise<void> {
  const from = await card.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error("Drag source or target is not visible");
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 12, from.y + from.height / 2 + 12, { steps: 4 });
  await page.mouse.move(to.x + to.width / 2, to.y + 60, { steps: 12 });
  await page.mouse.up();
}

test("dragging a card to another column is saved", async ({ page }) => {
  await page.goto("/work");
  const todo = page.getByTestId("column-todo");
  const inProgress = page.getByTestId("column-in_progress");

  const card = todo.locator("[data-testid^='task-']").first();
  const cardId = await card.getAttribute("data-testid");
  if (!cardId) throw new Error("No card in the To do column");
  const title = await card.getByRole("button").first().innerText();

  const saved = page.waitForResponse(
    (response) => response.request().method() === "POST" && response.url().includes("/work"),
  );
  await drag(page, card, inProgress);
  await expect(inProgress.getByTestId(cardId)).toBeVisible();
  await expect(todo.getByTestId(cardId)).toHaveCount(0);
  expect((await saved).ok()).toBe(true);

  await page.reload();
  await expect(page.getByTestId("column-in_progress").getByTestId(cardId)).toContainText(title);
  await expect(page.getByTestId("column-todo").getByTestId(cardId)).toHaveCount(0);

  // Put the card back so the test can run again on the same data.
  const restored = page.waitForResponse(
    (response) => response.request().method() === "POST" && response.url().includes("/work"),
  );
  await drag(page, page.getByTestId(cardId), page.getByTestId("column-todo"));
  await expect(page.getByTestId("column-todo").getByTestId(cardId)).toBeVisible();
  expect((await restored).ok()).toBe(true);
});

test("a task can be created from a column, edited and deleted", async ({ page }) => {
  const title = `E2E task ${Date.now()}`;
  await page.goto("/work");

  await page.getByRole("button", { name: "Add a task to Review" }).click();
  const dialog = page.getByRole("dialog", { name: "New task" });
  await dialog.getByLabel("Title").fill(title);
  await dialog.getByRole("button", { name: "Create task" }).click();
  await expect(dialog).toBeHidden();
  const card = page.getByTestId("column-review").getByText(title);
  await expect(card).toBeVisible();

  await card.click();
  const editing = page.getByRole("dialog", { name: "Edit task" });
  await editing.getByLabel("Priority").selectOption("urgent");
  await editing.getByRole("button", { name: "Save changes" }).click();
  await expect(editing).toBeHidden();

  await page.getByRole("radio", { name: "List" }).click();
  await expect(page).toHaveURL(/view=list/);
  const row = page.getByRole("row").filter({ hasText: title });
  await expect(row).toContainText("Urgent");
  await expect(row).toContainText("Review");

  page.once("dialog", (confirm) => void confirm.accept());
  await row.getByRole("button", { name: title }).click();
  await page
    .getByRole("dialog", { name: "Edit task" })
    .getByRole("button", { name: "Delete task" })
    .click();
  await expect(page.getByRole("row").filter({ hasText: title })).toHaveCount(0);
});
