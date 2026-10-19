import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { extractSections } from "./extract";
import { readDocument } from "./read-document";

const profileHtml = `<!doctype html>
<html>
  <body>
    <main>
      <section class="artdeco-card">
        <h1>Tim Glaser</h1>
        <div class="text-body-medium">CEO at TypeSafe. Builds evaluation systems.</div>
      </section>
      <section class="artdeco-card">
        <div id="about"></div>
        <h2>About</h2>
        <p>Works on decision quality and hiring tools.</p>
      </section>
      <section class="artdeco-card">
        <div id="experience"></div>
        <h2>Experience</h2>
        <ul>
          <li>CEO, TypeSafe — 2020 to present</li>
          <li>Engineer, earlier roles</li>
        </ul>
        <button>Show all 4 experiences</button>
      </section>
      <section class="artdeco-card">
        <h2>Activity</h2>
        <p>Posted a job</p>
      </section>
    </main>
  </body>
</html>`;

describe("readDocument", () => {
  it("reads LinkedIn profile cards instead of login and activity chrome", () => {
    const dom = new JSDOM(profileHtml, { url: "https://www.linkedin.com/in/tim-glaser/" });
    const doc = readDocument({ document: dom.window.document, location: { href: dom.window.location.href } });
    const extracted = extractSections(doc);

    expect(extracted.url).toBe("https://www.linkedin.com/in/tim-glaser/");
    expect(extracted.sections.map((section) => section.title)).toEqual(["Headline", "About", "Experience"]);
    expect(extracted.sections[0]?.text).toContain("Tim Glaser");
    expect(extracted.sections[0]?.text).toContain("CEO at TypeSafe");
    expect(extracted.sections[1]?.text).toContain("decision quality");
    expect(extracted.sections[2]?.text).toContain("CEO, TypeSafe");
    expect(extracted.sections[2]?.text).not.toMatch(/Show all/i);
  });

  it("reads a 2025 LinkedIn top card where the name is an h2 and IDs are gone", () => {
    const html = `<!doctype html>
<html>
  <head><title>Pouya Pourmasir | LinkedIn</title></head>
  <body>
    <main>
      <section class="artdeco-card">
        <a href="/in/pouyapournasir/">
          <h2 class="t-24">Pouya Pourmasir</h2>
        </a>
        <div class="text-body-medium">AI Product Engineer</div>
      </section>
      <section class="artdeco-card">
        <h2>About</h2>
        <p>Builds hiring tools.</p>
      </section>
      <section class="artdeco-card">
        <h2>Experience</h2>
        <p>AI Product Engineer at TypeSafe</p>
      </section>
    </main>
  </body>
</html>`;
    const dom = new JSDOM(html, { url: "https://www.linkedin.com/in/pouyapournasir/" });
    const extracted = extractSections(
      readDocument({ document: dom.window.document, location: { href: dom.window.location.href } }),
    );
    expect(extracted.candidateName).toBe("Pouya Pourmasir");
    expect(extracted.sections[0]).toMatchObject({
      title: "Headline",
      text: expect.stringContaining("Pouya Pourmasir"),
    });
    expect(extracted.sections.map((section) => section.title)).toContain("About");
  });

  it("falls back to the LinkedIn document title when the top card has no name node", () => {
    const html = `<!doctype html>
<html>
  <head><title>Tim Glaser | LinkedIn</title></head>
  <body>
    <main>
      <section class="artdeco-card">
        <h2>About</h2>
        <p>Works on hiring tools.</p>
      </section>
    </main>
  </body>
</html>`;
    const dom = new JSDOM(html, { url: "https://www.linkedin.com/in/tim-glaser/" });
    const extracted = extractSections(
      readDocument({ document: dom.window.document, location: { href: dom.window.location.href } }),
    );
    expect(extracted.candidateName).toBe("Tim Glaser");
    expect(extracted.sections[0]?.title).toBe("Headline");
    expect(extracted.sections[0]?.text).toContain("Tim Glaser");
  });

  it("still reads a plain h1/h2 page", () => {
    const html = `<h1>Headline</h1><p>Staff engineer, payments</p><h2>About</h2><p>Builds Go services</p>`;
    const dom = new JSDOM(html, { url: "https://example.com/sample" });
    const doc = readDocument({ document: dom.window.document, location: { href: "https://example.com/sample" } });
    expect(extractSections(doc).sections.map((section) => section.title)).toEqual(["Headline", "About"]);
  });
});
