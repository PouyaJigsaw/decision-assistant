import { resolve } from "node:path";
import { test as base, chromium, expect, type Browser, type Page } from "@playwright/test";

const CDP_URL = process.env.CHROME_CDP_URL ?? "http://127.0.0.1:9222";
const EXTENSION_PATH = resolve(process.cwd(), "apps/extension/unpacked/chrome-mv3");

export const JOB_DESCRIPTION =
  "Staff engineer. Five years of Go and distributed systems. Owns APIs end to end.";

export function account() {
  const email = process.env.ACCOUNT_EMAIL ?? "";
  const password = process.env.ACCOUNT_PASSWORD ?? "";
  if (!email || !password) {
    throw new Error("ACCOUNT_EMAIL and ACCOUNT_PASSWORD are required. Use the same values as apps/api/.env.");
  }
  return { email, password };
}

type Target = { url?: string; title?: string; type?: string };

async function listTargets(): Promise<Target[]> {
  const response = await fetch(`${CDP_URL}/json/list`);
  if (!response.ok) {
    throw new Error(
      `Chrome debugging port did not answer at ${CDP_URL}. Quit Chrome and relaunch it with --remote-debugging-port=9222.`,
    );
  }
  return (await response.json()) as Target[];
}

function extensionIdFrom(target: Target): string | undefined {
  return target.url?.match(/^chrome-extension:\/\/([a-z]{32})\//)?.[1];
}

async function idFromTargets(): Promise<string | undefined> {
  const targets = await listTargets();
  const named = targets.find(
    (target) =>
      extensionIdFrom(target) &&
      (target.url?.includes("sidepanel.html") || target.title?.includes("Who Fits?")),
  );
  return named ? extensionIdFrom(named) : undefined;
}

async function cdpCall(method: string, params: Record<string, string>): Promise<Record<string, unknown>> {
  const version = (await (await fetch(`${CDP_URL}/json/version`)).json()) as { webSocketDebuggerUrl: string };
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise<void>((resolveWs, reject) => {
    ws.addEventListener("open", () => resolveWs());
    ws.addEventListener("error", () => reject(new Error("Could not open the Chrome DevTools websocket")));
  });
  try {
    return await new Promise((resolveResult, reject) => {
      const id = 1;
      ws.addEventListener("message", (event) => {
        const message = JSON.parse(String(event.data)) as {
          id?: number;
          result?: Record<string, unknown>;
          error?: { message?: string };
        };
        if (message.id !== id) return;
        if (message.error) reject(new Error(message.error.message ?? method));
        else resolveResult(message.result ?? {});
      });
      ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => reject(new Error(`${method} timed out`)), 8000);
    });
  } finally {
    ws.close();
  }
}

export async function findExtensionId(): Promise<string> {
  const existing = await idFromTargets();
  if (existing) return existing;
  const loaded = await cdpCall("Extensions.loadUnpacked", { path: EXTENSION_PATH });
  const id = typeof loaded.id === "string" ? loaded.id : undefined;
  if (!id) {
    throw new Error(
      "Who Fits? is not loaded in this Chrome. Build the extension and keep Chrome on the debugging port.",
    );
  }
  return id;
}

async function connectBrowser(): Promise<Browser> {
  try {
    return await chromium.connectOverCDP(CDP_URL);
  } catch {
    throw new Error(
      `Could not attach to Chrome at ${CDP_URL}. Quit Chrome and relaunch it with --remote-debugging-port=9222.`,
    );
  }
}

function pagesOf(browser: Browser): Page[] {
  return browser.contexts().flatMap((context) => context.pages());
}

async function openSidePanel(browser: Browser, resetSession: boolean): Promise<Page> {
  const context = browser.contexts()[0];
  if (!context) {
    throw new Error("Chrome has no browser context. Relaunch Chrome with your normal profile and remote debugging.");
  }
  const id = await findExtensionId();
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${id}/sidepanel.html`);
  if (resetSession) {
    await panel.evaluate(async () => {
      const storage = (
        globalThis as {
          chrome?: {
            storage: {
              session: { clear: () => Promise<void> };
              local: { remove: (keys: string) => Promise<void> };
            };
          };
        }
      ).chrome?.storage;
      if (!storage?.session) throw new Error("chrome.storage.session is not available on the side panel page");
      await storage.session.clear();
      await storage.local.remove("sessionToken");
    });
    await panel.reload();
  }
  return panel;
}

export async function focusLinkedIn(browser: Browser): Promise<Page> {
  const existing = pagesOf(browser).find((page) => page.url().includes("linkedin.com/in/"));
  if (existing) {
    await existing.bringToFront();
    return existing;
  }
  const targets = await listTargets();
  const linkedIn = targets.find((target) => target.url?.includes("linkedin.com/in/"));
  if (!linkedIn?.url) {
    throw new Error("No linkedin.com/in/ tab is open. Open a signed-in LinkedIn profile in this Chrome.");
  }
  const context = browser.contexts()[0];
  if (!context) throw new Error("Chrome has no browser context.");
  const page = await context.newPage();
  await page.goto(linkedIn.url);
  await page.bringToFront();
  return page;
}

export const test = base.extend<{ panel: Page; browser: Browser }, { attached: Browser }>({
  attached: [
    async ({}, use) => {
      const browser = await connectBrowser();
      await use(browser);
    },
    { scope: "worker" },
  ],
  browser: async ({ attached }, use) => {
    await use(attached);
  },
  panel: async ({ attached }, use, testInfo) => {
    const panel = await openSidePanel(attached, testInfo.project.name === "sign-in");
    await use(panel);
    await panel.close();
  },
});

export { expect };
