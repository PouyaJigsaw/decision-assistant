export type PageScope = {
  document: Document;
  location: { href: string };
};

export type PageRead = {
  title: string;
  url: string;
  headings: { level: number; text: string; body: string }[];
};

export function readDocument(scope: PageScope = globalThis as unknown as PageScope): PageRead {
  const { document, location } = scope;
  const url = location.href;
  const PROFILE_IDS = [
    "about",
    "experience",
    "education",
    "skills",
    "licenses_and_certifications",
    "projects",
    "publications",
    "honors_and_awards",
    "volunteering_experience",
    "languages",
    "recommendations",
    "featured",
  ];
  const SKIP_TITLE = /^(activity|analytics|resources|interests|more profiles|people also viewed|explore|opportunities)$/i;

  function normalizeSpace(value: string): string {
    return value.replace(/\s+/g, " ").trim();
  }

  function innerText(el: Element): string {
    const withInner = el as HTMLElement;
    if (typeof withInner.innerText === "string" && withInner.innerText.trim()) return withInner.innerText;
    return el.textContent ?? "";
  }

  function titleFromId(id: string): string {
    return id
      .split("_")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }

  function cleanSectionText(section: Element, title: string): string {
    const raw = normalizeSpace(innerText(section));
    const withoutTitle = raw.startsWith(title) ? raw.slice(title.length).trim() : raw;
    return withoutTitle
      .replace(/\bShow all\b[\s\S]*$/i, "")
      .replace(/\bShow more\b/gi, "")
      .replace(/\bsee more\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function sectionFromCard(section: Element, fallbackTitle: string): PageRead["headings"][number] | null {
    const title = normalizeSpace(section.querySelector("h2, h3")?.textContent ?? "") || fallbackTitle;
    if (!title || SKIP_TITLE.test(title)) return null;
    const body = cleanSectionText(section, title);
    if (!body) return null;
    return { level: 2, text: title, body };
  }

  function asPersonName(value: string): string {
    const name = dedupeRepeatedName(normalizeSpace(value));
    if (!name || SKIP_TITLE.test(name) || /^(about|experience|education|skills|headline)$/i.test(name)) return "";
    const words = name.split(" ");
    if (words.length < 1 || words.length > 6) return "";
    const ok = words.every(
      (word) => /^[\p{L}][\p{L}'’.-]*$/u.test(word) && word[0] === word[0].toLocaleUpperCase(),
    );
    return ok ? name : "";
  }

  function dedupeRepeatedName(value: string): string {
    const words = value.split(" ");
    const half = Math.floor(words.length / 2);
    if (half > 0 && words.slice(0, half).join(" ") === words.slice(half).join(" ")) {
      return words.slice(0, half).join(" ");
    }
    return value;
  }

  function nameFromDocumentTitle(): string {
    const match = document.title.match(/^(.+?)\s*[|·–-]\s*LinkedIn\s*$/i);
    return asPersonName(match?.[1] ?? "");
  }

  function readTopCard(main: Element): PageRead["headings"][number] | null {
    const namedHeading = [main.querySelector("h1"), ...Array.from(main.querySelectorAll("h2"))]
      .filter((el): el is Element => Boolean(el))
      .find((el) => asPersonName(innerText(el)));
    const namedClass = Array.from(main.querySelectorAll(".text-heading-xlarge, .t-24")).find((el) =>
      asPersonName(innerText(el)),
    );
    const nameEl = namedHeading ?? namedClass ?? null;
    const name = asPersonName(nameEl ? innerText(nameEl) : "") || nameFromDocumentTitle();
    if (!name) return null;
    const card = nameEl?.closest("section") ?? nameEl?.parentElement ?? main;
    const headline =
      normalizeSpace(card.querySelector(".text-body-medium")?.textContent ?? "") ||
      normalizeSpace(nameEl?.nextElementSibling?.textContent ?? "");
    const headlineText = asPersonName(headline) ? "" : headline;
    return { level: 1, text: "Headline", body: [name, headlineText].filter(Boolean).join(" — ") };
  }

  function readLinkedInProfile(): PageRead["headings"] {
    const main = document.querySelector("main") ?? document.body;
    const headings: PageRead["headings"] = [];
    const headline = readTopCard(main);
    if (headline) headings.push(headline);

    const seen = new Set<string>();
    for (const id of PROFILE_IDS) {
      const anchor = document.getElementById(id);
      const section = anchor?.closest("section");
      if (!section) continue;
      const heading = sectionFromCard(section, titleFromId(id));
      if (!heading || seen.has(heading.text.toLowerCase())) continue;
      seen.add(heading.text.toLowerCase());
      headings.push(heading);
    }

    for (const section of Array.from(main.querySelectorAll("section"))) {
      const title = normalizeSpace(section.querySelector("h2, h3")?.textContent ?? "");
      if (!title || SKIP_TITLE.test(title) || seen.has(title.toLowerCase()) || asPersonName(title)) continue;
      const heading = sectionFromCard(section, title);
      if (!heading) continue;
      seen.add(heading.text.toLowerCase());
      headings.push(heading);
    }
    return headings;
  }

  function readHeadingOutline(): PageRead["headings"] {
    const headingEls = Array.from(document.querySelectorAll("h1, h2"));
    return headingEls.map((heading, index) => {
      const level = heading.tagName === "H1" ? 1 : 2;
      const text = normalizeSpace(heading.textContent ?? "");
      const chunks: string[] = [];
      let node: ChildNode | null = heading.nextSibling;
      const stop = headingEls[index + 1] ?? null;
      while (node && node !== stop) {
        if (node.nodeType === 3) {
          const value = node.textContent?.trim();
          if (value) chunks.push(value);
        } else if (node.nodeType === 1) {
          const child = node as Element;
          if (child.matches("h1, h2")) break;
          const value = normalizeSpace(child.textContent ?? "");
          if (value) chunks.push(value);
        }
        node = node.nextSibling;
      }
      return { level, text, body: chunks.join(" ") };
    });
  }

  if (/linkedin\.com\/in\//i.test(url)) {
    const headings = readLinkedInProfile();
    if (headings.length > 0) return { title: document.title, url, headings };
  }
  return { title: document.title, url, headings: readHeadingOutline() };
}
