import { expect, JOB_DESCRIPTION, test } from "./fixtures";

test("drafts and approves a rubric", async ({ panel }) => {
  test.setTimeout(180_000);
  await expect(panel.getByRole("heading", { name: "Create a role" })).toBeVisible();
  await panel.getByLabel("Role name").fill("Staff engineer");
  await panel.getByLabel("Company").fill("TypeSafe");
  await panel.getByLabel("Job description").fill(JOB_DESCRIPTION);
  await panel.getByRole("button", { name: "Draft rubric" }).click();
  await expect(panel.getByRole("heading", { name: "Review the rubric" })).toBeVisible();
  await expect(panel.getByLabel("Short name").first()).not.toHaveValue("");
  await panel.getByRole("button", { name: "Approve rubric" }).click();
  const sitting = panel.getByRole("button", { name: "Read this tab" });
  const evaluating = panel.getByRole("heading", { name: "Evaluating this profile" });
  const result = panel.getByRole("heading", { name: /^(Contact|Investigate|Save for later|Skip)$/ });
  await expect.poll(async () => {
    if (await sitting.isVisible()) return "sitting";
    if (await evaluating.isVisible()) return "evaluating";
    if (await result.isVisible()) return "result";
    return "waiting";
  }).toMatch(/^(sitting|evaluating|result)$/);
});
