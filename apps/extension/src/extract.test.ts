import { describe, expect, it } from "vitest";
import { extractSections } from "./extract";

describe("extractSections", () => {
  it("returns Headline and About sections and drops an empty heading", () => {
    const result = extractSections({
      title: "Alex Rivera | LinkedIn",
      url: "https://www.linkedin.com/in/alex",
      headings: [
        { level: 1, text: "Headline", body: "Staff engineer, payments" },
        { level: 2, text: "About", body: "Builds Go services" },
        { level: 2, text: "", body: "should be dropped" },
      ],
    });

    expect(result.url).toBe("https://www.linkedin.com/in/alex");
    expect(result.sections).toEqual([
      { id: "headline", title: "Headline", text: "Staff engineer, payments" },
      { id: "about", title: "About", text: "Builds Go services" },
    ]);
  });
});
