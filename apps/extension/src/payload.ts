export type PreviewSection = { id: string; title: string; text: string; removed: boolean };

export function approvedText(sections: PreviewSection[]): string {
  return sections
    .filter((section) => !section.removed)
    .map((section) => `${section.title}\n${section.text}`)
    .join("\n\n");
}
