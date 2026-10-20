export type ExtractSection = { id: string; title: string; text: string };
export type PreviewSection = ExtractSection & { removed: boolean };

export function approvedText(sections: PreviewSection[]): string {
  return sections
    .filter((section) => !section.removed)
    .map((section) => `${section.title}\n${section.text}`)
    .join("\n\n");
}

export function approvedExtractText(sections: ExtractSection[]): string {
  return approvedText(sections.map((section) => ({ ...section, removed: false })));
}
