import { candidateNameFromApprovedText, candidateNameFromPageTitle } from "@decision-assistant/domain";

export type Heading = { level: number; text: string; body: string };
export type ExtractDocument = { title: string; url: string; headings: Heading[] };
export type Section = { id: string; title: string; text: string };

export function extractSections(doc: ExtractDocument): { url: string; sections: Section[]; candidateName: string } {
  const sections = doc.headings
    .filter((heading) => heading.text.trim().length > 0)
    .map((heading) => ({
      id: slug(heading.text),
      title: heading.text,
      text: heading.body,
    }));
  const headline = sections.find((section) => section.title === "Headline");
  return {
    url: doc.url,
    sections,
    candidateName:
      candidateNameFromApprovedText(headline ? `Headline\n${headline.text}` : "") || candidateNameFromPageTitle(doc.title),
  };
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "section";
}
