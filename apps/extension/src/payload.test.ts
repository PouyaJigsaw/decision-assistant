import { describe, expect, it } from "vitest";
import { approvedExtractText, approvedText } from "./payload";

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

describe("approvedExtractText", () => {
  it("joins every captured section", () => {
    const text = approvedExtractText([
      { id: "headline", title: "Headline", text: "Staff engineer" },
      { id: "about", title: "About", text: "Builds Go services" },
      { id: "experience", title: "Experience", text: "four years" },
    ]);

    expect(text).toContain("Staff engineer");
    expect(text).toContain("Builds Go services");
    expect(text).toContain("four years");
  });
});
