/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const chromeState = vi.hoisted(() => {
  const local: Record<string, unknown> = {};
  const session: Record<string, unknown> = {};
  const listeners: Array<(changes: Record<string, { newValue: unknown }>) => void> = [];
  function area(store: Record<string, unknown>, notify = false) {
    return {
      async get(key: string | string[]) {
        if (Array.isArray(key)) {
          const found: Record<string, unknown> = {};
          for (const item of key) found[item] = store[item];
          return found;
        }
        return { [key]: store[key] };
      },
      async set(values: Record<string, unknown>) {
        const changes: Record<string, { newValue: unknown }> = {};
        for (const [key, value] of Object.entries(values)) {
          store[key] = value;
          changes[key] = { newValue: value };
        }
        if (notify) for (const listener of listeners) listener(changes);
      },
      async remove(keys: string | string[]) {
        for (const key of Array.isArray(keys) ? keys : [keys]) delete store[key];
      },
    };
  }
  return {
    local,
    session,
    listeners,
    reset() {
      for (const key of Object.keys(local)) delete local[key];
      for (const key of Object.keys(session)) delete session[key];
      listeners.length = 0;
    },
    storage: {
      local: area(local),
      session: {
        ...area(session, true),
        onChanged: {
          addListener(listener: (changes: Record<string, { newValue: unknown }>) => void) {
            listeners.push(listener);
          },
          removeListener(listener: (changes: Record<string, { newValue: unknown }>) => void) {
            const index = listeners.indexOf(listener);
            if (index >= 0) listeners.splice(index, 1);
          },
        },
      },
    },
  };
});

vi.stubGlobal("chrome", {
  runtime: {
    sendMessage: async () => ({ ok: true }),
    getURL: (path: string) => `chrome-extension://ext/${path}`,
  },
  tabs: {
    create: async () => ({ id: 1 }),
    update: async () => ({ id: 1 }),
    remove: async () => undefined,
    onUpdated: { addListener() {}, removeListener() {} },
  },
  webNavigation: {
    onBeforeNavigate: { addListener() {}, removeListener() {} },
    onErrorOccurred: { addListener() {}, removeListener() {} },
    onCommitted: { addListener() {}, removeListener() {} },
    onCompleted: { addListener() {}, removeListener() {} },
  },
  declarativeNetRequest: {
    updateSessionRules: async () => undefined,
  },
  storage: chromeState.storage,
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
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    chromeState.reset();
    chromeState.local.sessionToken = "tok-1";
    chromeState.session.openaiApiKey = "sk-test";
    chromeState.session.panelRole = { id: "role-1", title: "Senior backend" };
    chromeState.session.panelRubricId = "rubric-1";
    chromeState.session.panelCriteria = [{ id: "go", kind: "requirement", label: "Go", prompt: "Go?" }];
    chromeState.session.extract = extract;
    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/v1/me")) return json({ email: "r@x.com", usesRemaining: 3, successCount: 0, cap: 3 });
      if (url.endsWith("/v1/roles")) return json({ roles: [] });
      if (url.endsWith("/v1/evaluations") && init?.method !== "POST") {
        return json({ evaluations: [], totals: { jevUsd: 0, llmUsd: 0 } });
      }
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
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("evaluates a stored extract from Continue, Retry re-runs it, and a later extract does not navigate", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /Continue/ }));
    expect(await screen.findByRole("heading", { name: "Investigate" })).toBeTruthy();
    expect(screen.queryByText("Nothing is uploaded until you confirm.")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Preview the extract" })).toBeNull();

    const posted = fetchMock.mock.calls
      .filter(([url, init]) => String(url).endsWith("/v1/evaluations") && (init as RequestInit | undefined)?.method === "POST")
      .map(([, init]) => JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>);
    expect(posted).toHaveLength(1);
    expect(posted[0]?.comparisonEnabled).toBe(false);
    expect(posted[0]?.keepExtracts).toBe(false);
    expect(posted[0]?.approvedText).toContain("Staff engineer");
    expect(posted[0]?.approvedText).toContain("Builds Go services");
    expect(posted[0]?.approvedText).toContain("four years");

    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("heading", { name: "Investigate" })).toBeTruthy();
    expect(screen.queryByText("Nothing is uploaded until you confirm.")).toBeNull();
    expect(
      fetchMock.mock.calls.filter(
        ([url, init]) => String(url).endsWith("/v1/evaluations") && (init as RequestInit | undefined)?.method === "POST",
      ),
    ).toHaveLength(2);

    await chrome.storage.session.set({
      extract: { ...extract, url: "https://www.linkedin.com/in/two", capturedAt: 2 },
    });

    expect(screen.getByRole("heading", { name: "Investigate" })).toBeTruthy();
    expect(screen.queryByText("https://www.linkedin.com/in/two")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Preview the extract" })).toBeNull();
  });

  it("returns to the result from history", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/v1/me")) return json({ email: "r@x.com", usesRemaining: 3, successCount: 0, cap: 3 });
        if (url.endsWith("/v1/roles")) return json({ roles: [] });
        if (url.endsWith("/v1/evaluations") && init?.method !== "POST") {
          return json({
            evaluations: [
              {
                id: "e1",
                action: "investigate",
                roleTitle: "Senior backend",
                jevTotalUsd: 0.00009,
                llmTotalUsd: 0.014,
                comparisonEnabled: true,
              },
            ],
            totals: { jevUsd: 0.0004, llmUsd: 0.041 },
          });
        }
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
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: /Continue/ }));
    expect(await screen.findByRole("heading", { name: "Investigate" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "History" }));
    expect(await screen.findByRole("heading", { name: "Running total" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("heading", { name: "Investigate" })).toBeTruthy();
  });

  it("reopens a success row from history and returns with Back to history", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/v1/me")) return json({ email: "r@x.com", usesRemaining: 3, successCount: 0, cap: 3 });
        if (url.endsWith("/v1/roles")) return json({ roles: [] });
        if (url.endsWith("/v1/evaluations/e1") && init?.method !== "POST") {
          return json({
            id: "e1",
            status: "success",
            action: "investigate",
            score: 62,
            reasonCode: "missing_evidence",
            roleTitle: "Senior backend",
            answers: [{ criterionId: "go", label: "Go", result: "match", confidence: 0.9, excerpt: null, llmExcerpt: null }],
            jev: { usage: { inputTokens: 2180, outputTokens: 36 }, cost: { totalUsd: 0.00009 } },
            llm: { usage: { inputTokens: 412, outputTokens: 88 }, cost: { totalUsd: 0.014 } },
            usesRemaining: 2,
          });
        }
        if (url.endsWith("/v1/evaluations") && init?.method !== "POST") {
          return json({
            evaluations: [
              {
                id: "e1",
                status: "success",
                action: "investigate",
                roleTitle: "Senior backend",
                jevTotalUsd: 0.00009,
                llmTotalUsd: 0.014,
                comparisonEnabled: true,
              },
            ],
            totals: { jevUsd: 0.0004, llmUsd: 0.041 },
          });
        }
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
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: /Continue/ }));
    expect(await screen.findByRole("heading", { name: "Investigate" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "History" }));
    expect(await screen.findByRole("heading", { name: "Running total" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Senior backend/ }));
    expect(await screen.findByRole("heading", { name: "Investigate" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("heading", { name: "Running total" })).toBeTruthy();
  });

  it("returns to the job description from a result", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: /Continue/ }));
    expect(await screen.findByRole("heading", { name: "Investigate" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Change job description" }));
    expect(await screen.findByRole("heading", { name: "Saved roles" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Create a role" })).toBeNull();
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
    await user.click(await screen.findByRole("button", { name: /Continue/ }));
    expect(await screen.findByText("Evaluation failed")).toBeTruthy();
    expect(screen.queryByText("Nothing is uploaded until you confirm.")).toBeNull();
  });
});

describe("App sign up", () => {
  beforeEach(() => {
    chromeState.reset();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("creates an account and opens the role screen", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/v1/users") && init?.method === "POST") {
        expect(JSON.parse(String(init.body))).toEqual({
          email: "new.user@example.com",
          password: "long-enough",
        });
        return json({ token: "tok-signup", expiresAt: "2099-01-01T00:00:00.000Z" }, 201);
      }
      if (url.endsWith("/v1/me")) return json({ email: "new.user@example.com", usesRemaining: 3, successCount: 0, cap: 3 });
      if (url.endsWith("/v1/roles")) return json({ roles: [] });
      if (url.endsWith("/v1/evaluations")) return json({ evaluations: [], totals: { jevUsd: 0, llmUsd: 0 } });
      throw new Error(url);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Sign up" }));
    await user.click(screen.getByLabelText("Email"));
    await user.paste("new.user@example.com");
    await user.click(screen.getByLabelText("Password"));
    await user.paste("long-enough");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByRole("button", { name: "New job description" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Create a role" })).toBeNull();
    expect(chromeState.local.sessionToken).toBe("tok-signup");
    expect(fetchMock.mock.calls.some(([input, init]) => String(input).endsWith("/v1/session") && init?.method === "POST")).toBe(
      false,
    );
  });

  it("shows taken-email copy when the address is already registered", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/v1/users") && init?.method === "POST") {
          return json({ error: "email_taken" }, 409);
        }
        throw new Error(url);
      }),
    );
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Sign up" }));
    await user.click(screen.getByLabelText("Email"));
    await user.paste("taken@example.com");
    await user.click(screen.getByLabelText("Password"));
    await user.paste("long-enough");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByText("That email is already registered.")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Create a role" })).toBeNull();
  });
});

function dashboardFetch(init?: RequestInit) {
  return vi.fn(async (input: RequestInfo | URL, requestInit?: RequestInit) => {
    const url = String(input);
    const method = requestInit?.method ?? init?.method;
    if (url.endsWith("/v1/session") && requestInit?.method === "POST") {
      return json({ token: "tok-1", expiresAt: "2099-01-01T00:00:00.000Z" });
    }
    if (url.endsWith("/v1/me")) return json({ email: "r@x.com", usesRemaining: 3, successCount: 0, cap: 3 });
    if (url.endsWith("/v1/roles/role-1/rubrics/current")) {
      return json({
        id: "rv1",
        version: 1,
        title: "Senior backend",
        company: "Stripe",
        summary: "Need a staff Go engineer.",
        notes: "Need a staff Go engineer who owns APIs and the payments platform.",
        criteria: [{ id: "go", kind: "requirement", label: "Go", prompt: "Is there evidence of Go?" }],
      });
    }
    if (url.endsWith("/v1/roles")) return json({ roles: [{ id: "role-1", title: "Senior backend", company: "Stripe", summary: "Need a staff Go engineer." }] });
    if (url.endsWith("/v1/evaluations") && requestInit?.method !== "POST") {
      return json({
        evaluations: [
          {
            id: "e1",
            status: "success",
            action: "investigate",
            roleId: "role-1",
            roleTitle: "Senior backend",
            jevTotalUsd: 0.00009,
            llmTotalUsd: 0.014,
            comparisonEnabled: true,
          },
        ],
        totals: { jevUsd: 0.0004, llmUsd: 0.041 },
      });
    }
    if (url.endsWith("/v1/evaluations/e1")) {
      return json({
        id: "e1",
        status: "success",
        action: "investigate",
        score: 62,
        reasonCode: "missing_evidence",
        roleTitle: "Senior backend",
        answers: [],
        jev: { usage: { inputTokens: 2180, outputTokens: 36 }, cost: { totalUsd: 0.00009 } },
        llm: { usage: { inputTokens: 412, outputTokens: 88 }, cost: { totalUsd: 0.014 } },
        usesRemaining: 2,
      });
    }
    if (url.endsWith("/v1/evaluations") && method === "POST") {
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
  });
}

describe("App dashboard", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("lands on the dashboard after sign-in, not Create a role", async () => {
    chromeState.reset();
    vi.stubGlobal("fetch", dashboardFetch());
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByLabelText("Email"));
    await user.paste("r@x.com");
    await user.click(screen.getByLabelText("Password"));
    await user.paste("sitting-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("button", { name: "New job description" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Create a role" })).toBeNull();
  });

  it("opens Role from New job description", async () => {
    chromeState.reset();
    chromeState.local.sessionToken = "tok-1";
    chromeState.session.openaiApiKey = "sk-test";
    vi.stubGlobal("fetch", dashboardFetch());
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "New job description" }));
    expect(await screen.findByRole("heading", { name: "Create a role" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("heading", { name: "Saved roles" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Create a role" })).toBeNull();
  });

  it("evaluates from Continue when a rubric and extract are stored", async () => {
    chromeState.reset();
    chromeState.local.sessionToken = "tok-1";
    chromeState.session.openaiApiKey = "sk-test";
    chromeState.session.panelRole = { id: "role-1", title: "Senior backend" };
    chromeState.session.panelRubricId = "rubric-1";
    chromeState.session.panelCriteria = [{ id: "go", kind: "requirement", label: "Go", prompt: "Go?" }];
    chromeState.session.extract = extract;
    vi.stubGlobal("fetch", dashboardFetch());
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /Continue/ }));
    expect(await screen.findByRole("heading", { name: "Investigate" })).toBeTruthy();
    expect(screen.queryByText("Nothing is uploaded until you confirm.")).toBeNull();
  });

  it("opens a saved role with the job description and rubric", async () => {
    chromeState.reset();
    chromeState.local.sessionToken = "tok-1";
    chromeState.session.openaiApiKey = "sk-test";
    vi.stubGlobal("fetch", dashboardFetch());
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /Stripe/ }));
    expect(await screen.findByRole("heading", { name: "Job description" })).toBeTruthy();
    expect(screen.getByText(/owns APIs and the payments platform/)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Rubric" })).toBeTruthy();
    expect(screen.getByText("Go")).toBeTruthy();
    expect(screen.getByText("Is there evidence of Go?")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Change job description" }));
    expect(await screen.findByRole("heading", { name: "Create a role" })).toBeTruthy();
    expect((screen.getByLabelText("Role name") as HTMLInputElement).value).toBe("Senior backend");
    expect((screen.getByLabelText("Company") as HTMLInputElement).value).toBe("Stripe");
    expect((screen.getByLabelText("Job description") as HTMLTextAreaElement).value).toContain("owns APIs");
    expect(screen.queryByRole("heading", { name: "Saved roles" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("heading", { name: "Job description" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Create a role" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Saved roles" })).toBeNull();
  });

  it("opens Result from a recent success row and Back to dashboard returns home", async () => {
    chromeState.reset();
    chromeState.local.sessionToken = "tok-1";
    chromeState.session.openaiApiKey = "sk-test";
    vi.stubGlobal("fetch", dashboardFetch());
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /Evaluated for Senior backend/ }));
    expect(await screen.findByRole("heading", { name: "Investigate" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Home" }));
    expect(await screen.findByRole("heading", { name: "Saved roles" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "New job description" })).toBeTruthy();
    await user.click(await screen.findByRole("button", { name: /Evaluated for Senior backend/ }));
    expect(await screen.findByRole("heading", { name: "Investigate" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("heading", { name: "Saved roles" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "New job description" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
  });

  it("returns to the dashboard from a saved role via header Back", async () => {
    chromeState.reset();
    chromeState.local.sessionToken = "tok-1";
    chromeState.session.openaiApiKey = "sk-test";
    vi.stubGlobal("fetch", dashboardFetch());
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /Stripe/ }));
    expect(await screen.findByRole("heading", { name: "Job description" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("heading", { name: "Saved roles" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Job description" })).toBeNull();
  });

  it("returns to the dashboard from History opened on the dashboard", async () => {
    chromeState.reset();
    chromeState.local.sessionToken = "tok-1";
    chromeState.session.openaiApiKey = "sk-test";
    vi.stubGlobal("fetch", dashboardFetch());
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "History" }));
    expect(await screen.findByRole("heading", { name: "Running total" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("heading", { name: "Saved roles" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "New job description" })).toBeTruthy();
  });
});
