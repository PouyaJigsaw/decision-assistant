import { describe, expect, it } from "vitest";
import { candidateNameFromApprovedText, parseJobPosting } from "./posting";

describe("parseJobPosting", () => {
  it("reads a LinkedIn job paste: title, company from the · line, and a short summary", () => {
    const notes = `Forward Deployed Engineer
AIM · San Francisco Bay Area · Remote

AIM is a deep-tech startup building evaluation systems for hiring teams. You will sit with customers and ship production software.

More requirements follow here.`;
    const parsed = parseJobPosting(notes);
    expect(parsed.title).toBe("Forward Deployed Engineer");
    expect(parsed.company).toBe("AIM");
    expect(parsed.summary).toContain("deep-tech startup");
    expect(parsed.summary.length).toBeLessThanOrEqual(160);
  });

  it("reads company from a title of the form Role at Company", () => {
    const parsed = parseJobPosting("Staff Software Engineer at Stripe\n\nWe are hiring a staff engineer for payments.");
    expect(parsed.title).toBe("Staff Software Engineer at Stripe");
    expect(parsed.company).toBe("Stripe");
    expect(parsed.summary).toContain("hiring a staff engineer");
  });

  it("leaves company empty when the paste has no company line", () => {
    const parsed = parseJobPosting("Need a staff Go engineer.\n\nBuild APIs and own the payments platform.");
    expect(parsed.title).toBe("Need a staff Go engineer");
    expect(parsed.company).toBe("");
    expect(parsed.summary).toContain("Build APIs");
  });

  it("skips About the job and reads company plus role from the opening paragraph", () => {
    const parsed = parseJobPosting(
      "About the job\nPCT partners with venture-backed technology companies looking for Forward Deployed Engineers (FDEs) who can bridge the gap between sophisticated technology and real operations.",
    );
    expect(parsed.title).toMatch(/Forward Deployed Engineer/i);
    expect(parsed.company).toBe("PCT");
    expect(parsed.summary).toContain("venture-backed");
  });

  it("reads company from an AIM-style opening sentence", () => {
    const parsed = parseJobPosting(
      "AIM is a deep-tech startup building advanced high-power laser systems to protect critical infrastructure.",
    );
    expect(parsed.company).toBe("AIM");
    expect(parsed.summary).toContain("deep-tech startup");
  });
});

describe("candidateNameFromApprovedText", () => {
  it("takes the name from a Headline section", () => {
    expect(
      candidateNameFromApprovedText("Headline\nTim Glaser — CEO at TypeSafe\n\nAbout\nWorks on hiring tools."),
    ).toBe("Tim Glaser");
  });

  it("returns empty when there is no Headline", () => {
    expect(candidateNameFromApprovedText("About\nWorks on hiring tools.")).toBe("");
  });

  it("takes a person name from a LinkedIn page title", () => {
    expect(candidateNameFromApprovedText("Tim Glaser | LinkedIn")).toBe("Tim Glaser");
    expect(candidateNameFromApprovedText("Pouya Pourmasir - LinkedIn")).toBe("Pouya Pourmasir");
  });
});
