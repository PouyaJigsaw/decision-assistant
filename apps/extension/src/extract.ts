export type Heading = { level: number; text: string; body: string };
export type ExtractDocument = { title: string; url: string; headings: Heading[] };
export type Section = { id: string; title: string; text: string };

export function extractSections(doc: ExtractDocument): { url: string; sections: Section[] } {
  return {
    url: doc.url,
    sections: doc.headings
      .filter((heading) => heading.text.trim().length > 0)
      .map((heading) => ({
        id: slug(heading.text),
        title: heading.text,
        text: heading.body,
      })),
  };
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "section";
}
