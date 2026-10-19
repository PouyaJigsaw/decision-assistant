import {
  chromeLocalKv,
  createChromeOAuthHost,
  disconnectChatGpt,
  signInWithChatGpt,
} from "../src/chatgpt-oauth";
import { extractSections } from "../src/extract";
import { readDocument } from "../src/read-document";

export default defineBackground(() => {
  chrome.runtime.onInstalled.addListener(() => {
    void chrome.sidePanel.setOptions({ path: "sidepanel.html", enabled: true });
    void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
  });
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });

  chrome.action.onClicked.addListener((tab) => {
    void captureAndOpen(tab.id);
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message !== "object") return;
    if (message.type === "capture") {
      void captureAndOpen(typeof message.tabId === "number" ? message.tabId : undefined).then(() => {
        sendResponse({ ok: true });
      });
      return true;
    }
    if (message.type === "chatgpt-signin") {
      void signInWithChatGpt(createChromeOAuthHost(), chromeLocalKv())
        .then((session) => sendResponse({ ok: true, session }))
        .catch((error: unknown) =>
          sendResponse({ ok: false, error: error instanceof Error ? error.message : "oauth_failed" }),
        );
      return true;
    }
    if (message.type === "chatgpt-disconnect") {
      void disconnectChatGpt(createChromeOAuthHost(), chromeLocalKv())
        .then(() => sendResponse({ ok: true }))
        .catch((error: unknown) =>
          sendResponse({ ok: false, error: error instanceof Error ? error.message : "oauth_failed" }),
        );
      return true;
    }
  });
});

async function captureAndOpen(tabId: number | undefined) {
  if (tabId == null) {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    tabId = tab?.id;
  }
  if (tabId == null) return;
  try {
    const injected = await chrome.scripting.executeScript({
      target: { tabId },
      func: readDocument,
    });
    const doc = injected[0]?.result;
    if (!doc) {
      await chrome.storage.session.set({
        extract: {
          url: "",
          sections: [
            {
              id: "capture-failed",
              title: "Capture failed",
              text: "The script ran but returned no page text. Stay on the page you want and try Read this tab.",
            },
          ],
          capturedAt: Date.now(),
        },
      });
    } else {
      const extracted = extractSections(doc);
      await chrome.storage.session.set({
        extract: {
          url: extracted.url,
          sections: extracted.sections,
          capturedAt: Date.now(),
        },
      });
    }
  } catch (error) {
    await chrome.storage.session.set({
      extract: {
        url: "",
        sections: [
          {
            id: "capture-failed",
            title: "Capture failed",
            text:
              error instanceof Error
                ? error.message
                : "The page could not be read. Open a profile tab and click the toolbar icon.",
          },
        ],
        capturedAt: Date.now(),
      },
    });
  }
  await chrome.sidePanel.open({ tabId });
}
