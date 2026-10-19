export type CaptureTab = { id?: number; url?: string; lastAccessed?: number };

export function pickCaptureTab(tabs: CaptureTab[]): CaptureTab | null {
  const pages = tabs.filter(
    (tab) => tab.id != null && typeof tab.url === "string" && /^https?:\/\//.test(tab.url),
  );
  if (pages.length === 0) return null;
  return [...pages].sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))[0] ?? null;
}
