import { describe, expect, it } from "vitest";
import { pickCaptureTab } from "./capture-tab";

describe("pickCaptureTab", () => {
  it("reads the most recently focused http tab, not another LinkedIn profile", () => {
    const chosen = pickCaptureTab([
      { id: 1, url: "https://www.linkedin.com/in/old", lastAccessed: 10 },
      { id: 2, url: "https://www.linkedin.com/jobs/view/123", lastAccessed: 30 },
      { id: 3, url: "chrome-extension://abc/sidepanel.html", lastAccessed: 40 },
    ]);
    expect(chosen?.url).toBe("https://www.linkedin.com/jobs/view/123");
  });
});
