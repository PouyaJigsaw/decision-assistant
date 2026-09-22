import { describe, expect, it } from "vitest";
import { approvedText } from "./payload";

describe("approvedText", () => {
  it("joins kept sections and drops a removed About body", () => {
    const text = approvedText([
      { id: "headline", title: "Headline", text: "Staff engineer", removed: false },
      { id: "about", title: "About", text: "Builds Go services", removed: true },
      { id: "experience", title: "Experience", text: "four years", removed: false },
    ]);

    expect(text).toContain("Staff engineer");
    expect(text).toContain("four years");
    expect(text).not.toContain("Builds Go services");
  });
});
