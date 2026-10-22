import { expect, test } from "./fixtures";

const RESULT_HEADING = /^(Contact|Investigate|Save for later|Skip)$/;

test("evaluates the profile and shows the recommendation", async ({ panel }) => {
  test.setTimeout(180_000);
  await expect(panel.getByRole("button", { name: "Read this tab" })).toBeVisible();
  await panel.getByRole("button", { name: "Read this tab" }).click();
  await expect(panel.getByRole("heading", { name: RESULT_HEADING })).toBeVisible({ timeout: 180_000 });
  await expect(panel.locator(".score")).toHaveText(/^-?\d/);
  await panel.getByRole("button", { name: "History" }).click();
  await expect(panel.getByRole("heading", { name: "Running total" })).toBeVisible();
  await expect(panel.locator("article.card").first()).toBeVisible();
});
