import { extractSections } from "../src/extract";

function readDocument() {
  const headingEls = Array.from(document.querySelectorAll("h1, h2"));
  const headings = headingEls.map((heading, index) => {
    const level = heading.tagName === "H1" ? 1 : 2;
    const text = (heading.textContent ?? "").trim();
    const chunks: string[] = [];
    let node: ChildNode | null = heading.nextSibling;
    const stop = headingEls[index + 1] ?? null;
    while (node && node !== stop) {
      if (node.nodeType === Node.TEXT_NODE) {
        const value = node.textContent?.trim();
        if (value) chunks.push(value);
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as Element;
        if (el.matches("h1, h2")) break;
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let textNode = walker.nextNode();
        while (textNode) {
          const value = textNode.textContent?.trim();
          if (value) chunks.push(value);
          textNode = walker.nextNode();
        }
      }
      node = node.nextSibling;
    }
    return { level, text, body: chunks.join(" ") };
  });
  return { title: document.title, url: location.href, headings };
}

export default defineBackground(() => {
  chrome.runtime.onInstalled.addListener(() => {
    void chrome.sidePanel.setOptions({ path: "sidepanel.html", enabled: true });
  });

  chrome.action.onClicked.addListener((tab) => {
    void captureAndOpen(tab.id);
  });
});

async function captureAndOpen(tabId: number | undefined) {
  if (tabId == null) return;
  const injected = await chrome.scripting.executeScript({
    target: { tabId },
    func: readDocument,
  });
  const doc = injected[0]?.result;
  if (!doc) return;
  const extracted = extractSections(doc);
  await chrome.storage.session.set({
    extract: {
      url: extracted.url,
      sections: extracted.sections,
      capturedAt: Date.now(),
    },
  });
  await chrome.sidePanel.open({ tabId });
}
