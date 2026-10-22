import { account, expect, test } from "./fixtures";

test("signs in and restores the session", async ({ panel }) => {
  const { email, password } = account();
  await expect(panel.getByLabel("Email")).toBeVisible();
  await panel.getByLabel("Email").fill(email);
  await panel.getByLabel("Password").fill(password);
  await panel.getByRole("button", { name: "Sign in" }).click();
  await expect(panel.getByRole("heading", { name: "Create a role" })).toBeVisible();
  await panel.reload();
  await expect(panel.getByRole("heading", { name: "Create a role" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Sign in" })).toHaveCount(0);
});
