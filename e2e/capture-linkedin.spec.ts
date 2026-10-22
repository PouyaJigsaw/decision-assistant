import { expect, focusLinkedIn, test } from "./fixtures";

test("captures the open LinkedIn profile", async ({ panel, browser }) => {
  await expect(panel.getByRole("button", { name: "Read this tab" })).toBeVisible();
  await focusLinkedIn(browser);
  await panel.evaluate(() => {
    const button = [...document.querySelectorAll("button")].find(
      (item) => item.textContent?.trim() === "Read this tab",
    );
    if (!button) throw new Error("Read this tab button not found");
    button.click();
  });

  const evaluating = panel.getByRole("heading", { name: "Evaluating this profile" });
  const result = panel.getByRole("heading", { name: /^(Contact|Investigate|Save for later|Skip)$/ });
  const captureError = panel.locator("p.error");
  await expect.poll(async () => {
    if (await evaluating.isVisible()) return "evaluating";
    if (await result.isVisible()) return "result";
    if (await captureError.isVisible()) return (await captureError.textContent())?.trim() || "capture failed";
    return "waiting";
  }).toMatch(/^(evaluating|result)$/);
});
