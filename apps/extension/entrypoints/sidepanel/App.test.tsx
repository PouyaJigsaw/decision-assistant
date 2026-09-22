/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const chromeState = vi.hoisted(() => {
  const store: Record<string, unknown> = {};
  const listeners: Array<(changes: Record<string, { newValue: unknown }>) => void> = [];
  return {
    store,
    listeners,
    reset() {
      for (const key of Object.keys(store)) delete store[key];
      listeners.length = 0;
    },
  };
});

vi.stubGlobal("chrome", {
  storage: {
    session: {
      async get(key: string | string[]) {
        if (Array.isArray(key)) {
          const found: Record<string, unknown> = {};
          for (const item of key) found[item] = chromeState.store[item];
          return found;
        }
        return { [key]: chromeState.store[key] };
      },
      async set(values: Record<string, unknown>) {
        const changes: Record<string, { newValue: unknown }> = {};
        for (const [key, value] of Object.entries(values)) {
          chromeState.store[key] = value;
          changes[key] = { newValue: value };
        }
        for (const listener of chromeState.listeners) listener(changes);
      },
      onChanged: {
        addListener(listener: (changes: Record<string, { newValue: unknown }>) => void) {
          chromeState.listeners.push(listener);
        },
        removeListener(listener: (changes: Record<string, { newValue: unknown }>) => void) {
          const index = chromeState.listeners.indexOf(listener);
          if (index >= 0) chromeState.listeners.splice(index, 1);
        },
      },
    },
  },
});

const { App } = await import("./App");

const extract = {
  url: "https://www.linkedin.com/in/one",
  sections: [
    { id: "headline", title: "Headline", text: "Staff engineer" },
    { id: "about", title: "About", text: "Builds Go services" },
    { id: "experience", title: "Experience", text: "four years" },
  ],
  capturedAt: 1,
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

describe("App sitting flow", () => {
  beforeEach(() => {
    chromeState.reset();
    chromeState.store.sessionToken = "tok-1";
    chromeState.store.panelRole = { id: "role-1", title: "Senior backend" };
    chromeState.store.panelRubricId = "rubric-1";
    chromeState.store.panelCriteria = [{ id: "go", kind: "requirement", label: "Go", prompt: "Go?" }];
    chromeState.store.extract = extract;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/v1/me")) return json({ email: "r@x.com", usesRemaining: 3, successCount: 0, cap: 3 });
        if (url.endsWith("/v1/evaluations")) {
          return json({
            id: "e1",
            status: "success",
            action: "investigate",
            score: 62,
            reasonCode: "missing_evidence",
            answers: [],
            jev: { usage: { inputTokens: 2180, outputTokens: 36 }, cost: { totalUsd: 0.00009 } },
            llm: { usage: { inputTokens: 412, outputTokens: 88 }, cost: { totalUsd: 0.014 } },
            usesRemaining: 2,
          });
        }
        throw new Error(url);
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("opens preview for a stored rubric and extract, then a later extract returns to preview", async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByText("Nothing is uploaded until you confirm.")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Evaluate" }));
    expect(await screen.findByRole("heading", { name: "Investigate" })).toBeTruthy();

    await chrome.storage.session.set({
      extract: { ...extract, url: "https://www.linkedin.com/in/two", capturedAt: 2 },
    });

    expect(await screen.findByText("https://www.linkedin.com/in/two")).toBeTruthy();
    expect(screen.getByText("Nothing is uploaded until you confirm.")).toBeTruthy();
  });

  it("shows an error when evaluate cannot reach the API", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/v1/me")) return json({ email: "r@x.com", usesRemaining: 3, successCount: 0, cap: 3 });
        throw new TypeError("Failed to fetch");
      }),
    );
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByText("Nothing is uploaded until you confirm.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Evaluate" }));
    expect(await screen.findByText("Evaluation failed")).toBeTruthy();
  });
});
