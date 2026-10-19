/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JEV_PRICE, costFromUsage } from "@decision-assistant/domain";
import { ApiError } from "../../src/api";
import { DashboardScreen } from "./DashboardScreen";
import { SittingScreen } from "./SittingScreen";
import { ErrorScreen } from "./ErrorScreen";
import { EvaluatingScreen } from "./EvaluatingScreen";
import { HistoryScreen } from "./HistoryScreen";
import { PRODUCT_NAME } from "../../src/copy";
import { PanelHeader } from "./PanelHeader";
import { PreviewScreen } from "./PreviewScreen";
import { ResultScreen } from "./ResultScreen";
import { RoleScreen } from "./RoleScreen";
import { RubricScreen } from "./RubricScreen";
import { SignInScreen } from "./SignInScreen";
import { billingCopy, ConnectionScreen } from "./ConnectionScreen";

afterEach(() => {
  cleanup();
});

describe("PanelHeader", () => {
  it("renders a Back control at the right of the header when onBack is set", async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    render(<PanelHeader title={PRODUCT_NAME} onBack={onBack} />);

    const header = document.querySelector(".panel-brand");
    const back = screen.getByRole("button", { name: "Back" });
    expect(header?.lastElementChild).toBe(back);
    expect(back.querySelector("svg")).toBeTruthy();
    expect(back.textContent).toMatch(/Back/);
    await user.click(back);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("omits Back when onBack is not set", () => {
    render(<PanelHeader title={PRODUCT_NAME} />);
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
  });
});

function enoughJobDescription() {
  return Array.from({ length: 150 }, (_, index) => `requirement${index}`).join(" ");
}

const previewSections = [
  { id: "headline", title: "Headline", text: "Staff engineer" },
  { id: "about", title: "About", text: "Builds Go services" },
  { id: "experience", title: "Experience", text: "four years" },
];

describe("SignInScreen", () => {
  it("shows the product name", () => {
    render(<SignInScreen onSubmit={async () => undefined} onSignup={async () => undefined} />);
    expect(screen.getByRole("heading", { name: PRODUCT_NAME })).toBeTruthy();
    expect(PRODUCT_NAME).toBe("Who Fits?");
  });

  it("posts Create account through onSignup and does not call login", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => undefined);
    const onSignup = vi.fn(async () => undefined);

    render(<SignInScreen onSubmit={onSubmit} onSignup={onSignup} />);

    await user.click(screen.getByRole("button", { name: "Sign up" }));
    await user.click(screen.getByLabelText("Email"));
    await user.paste("new.user@example.com");
    await user.click(screen.getByLabelText("Password"));
    await user.paste("long-enough");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(onSignup).toHaveBeenCalledWith("new.user@example.com", "long-enough");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("shows taken-email copy", () => {
    render(
      <SignInScreen
        onSubmit={async () => undefined}
        onSignup={async () => undefined}
        error="That email is already registered."
      />,
    );

    expect(screen.getByText("That email is already registered.")).toBeTruthy();
  });

  it("does not show a header Back control", () => {
    render(<SignInScreen onSubmit={async () => undefined} onSignup={async () => undefined} />);
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
  });
});

describe("ConnectionScreen", () => {
  it("offers Continue with ChatGPT and an API key when nothing is connected", async () => {
    const user = userEvent.setup();
    const onConnectChatGpt = vi.fn(async () => undefined);
    const onSaveKey = vi.fn(async () => undefined);
    render(
      <ConnectionScreen
        connection={{ kind: "none" }}
        models={[]}
        selectedModel=""
        showWelcome={false}
        onConnectChatGpt={onConnectChatGpt}
        onDisconnect={async () => undefined}
        onSaveKey={onSaveKey}
        onClearKey={async () => undefined}
        onSelectModel={() => undefined}
        onManageUsage={() => undefined}
        onDismissWelcome={() => undefined}
      />,
    );
    expect(screen.getByRole("button", { name: "Continue with ChatGPT" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Use an API key" })).toBeTruthy();
    expect(screen.getByText(billingCopy({ kind: "none" }))).toBeTruthy();
    await user.click(screen.getByLabelText("OpenAI API key"));
    await user.paste("sk-test");
    await user.click(screen.getByRole("button", { name: "Use an API key" }));
    expect(onSaveKey).toHaveBeenCalledWith("sk-test");
    expect(screen.queryByDisplayValue("sk-test")).toBeNull();
  });

  it("confirms ChatGPT plan usage once and never shows the key after save", async () => {
    const user = userEvent.setup();
    const onDismissWelcome = vi.fn();
    const onManageUsage = vi.fn();
    render(
      <ConnectionScreen
        connection={{ kind: "chatgpt", email: "user@example.com", planUsage: true }}
        models={[{ slug: "gpt-5.4", display_name: "GPT-5.4" }]}
        selectedModel="gpt-5.4"
        showWelcome
        onConnectChatGpt={async () => undefined}
        onDisconnect={async () => undefined}
        onSaveKey={async () => undefined}
        onClearKey={async () => undefined}
        onSelectModel={() => undefined}
        onManageUsage={onManageUsage}
        onDismissWelcome={onDismissWelcome}
      />,
    );
    expect(screen.getByText("You’re using your ChatGPT plan")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Got it" }));
    expect(onDismissWelcome).toHaveBeenCalled();
    expect(screen.getAllByText("Using ChatGPT plan").length).toBeGreaterThan(0);
    expect(screen.getByText("user@example.com")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Manage usage" }));
    expect(onManageUsage).toHaveBeenCalled();
    expect(screen.queryByLabelText("OpenAI API key")).toBeNull();
  });
});

describe("RoleScreen", () => {
  it("sends the job description to draftRubric", async () => {
    const user = userEvent.setup();
    const draftRubric = vi.fn(async () => ({
      criteria: [],
      omitted: [],
      usage: { inputTokens: 100, outputTokens: 40 },
      cost: { inputUsd: 0.001, outputUsd: 0.002, totalUsd: 0.003 },
    }));

    render(<RoleScreen api={{ draftRubric }} onDrafted={() => undefined} />);

    expect(document.querySelector("img.brand-mark")).toBeTruthy();
    const notes = enoughJobDescription();
    await user.click(screen.getByLabelText("Job description"));
    await user.paste(notes);
    await user.click(screen.getByRole("button", { name: "Draft rubric" }));

    expect(draftRubric).toHaveBeenCalledWith(notes);
  });

  it("rejects an empty or short job description without calling the model", async () => {
    const user = userEvent.setup();
    const draftRubric = vi.fn(async () => {
      throw new Error("should not draft");
    });

    render(<RoleScreen api={{ draftRubric }} onDrafted={() => undefined} />);

    await user.click(screen.getByRole("button", { name: "Draft rubric" }));
    expect(
      screen.getByText("This job description is not sufficient. Paste the full posting — at least 150 words."),
    ).toBeTruthy();
    expect(draftRubric).not.toHaveBeenCalled();

    await user.click(screen.getByLabelText("Job description"));
    await user.paste("Need a staff Go engineer");
    await user.click(screen.getByRole("button", { name: "Draft rubric" }));
    expect(draftRubric).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "Draft rubric" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("explains when the comparison model fails to draft", async () => {
    const user = userEvent.setup();
    const onDrafted = vi.fn();
    const draftRubric = vi.fn(async () => {
      throw new ApiError(502, { error: "llm_failed" });
    });

    render(<RoleScreen api={{ draftRubric }} onDrafted={onDrafted} />);

    await user.click(screen.getByLabelText("Job description"));
    await user.paste(enoughJobDescription());
    await user.click(screen.getByRole("button", { name: "Draft rubric" }));

    await waitFor(() => {
      expect(
        screen.getByText(
          "The comparison model did not finish a rubric. Nothing was sent to Jev. Wait and try again.",
        ),
      ).toBeTruthy();
    });
    expect(onDrafted).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Create a role" })).toBeTruthy();
  });
});

describe("RubricScreen", () => {
  it("shows omitted terms and posts the edited prompt", async () => {
    const user = userEvent.setup();
    const approveRubric = vi.fn(async () => ({ id: "rv1", version: 1, criteria: [] }));

    render(
      <RubricScreen
        omitted={["age"]}
        usage={{ inputTokens: 120, outputTokens: 48 }}
        cost={{ totalUsd: 0.008 }}
        criteria={[
          {
            id: "go",
            kind: "requirement",
            label: "Go",
            prompt: "Is there evidence of Go?",
          },
        ]}
        api={{ approveRubric }}
        onApproved={() => undefined}
        onChangeJob={() => undefined}
      />,
    );

    expect(screen.getByText("Omitted: age")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Change job description" })).toBeTruthy();

    await user.clear(screen.getByDisplayValue("Is there evidence of Go?"));
    await user.type(screen.getByLabelText("Prompt"), "edited prompt");
    await user.click(screen.getByRole("button", { name: "Approve rubric" }));

    expect(approveRubric).toHaveBeenCalledWith([
      { id: "go", kind: "requirement", label: "Go", prompt: "edited prompt" },
    ]);
  });

  it("lets the recruiter go back to change the job description", async () => {
    const user = userEvent.setup();
    const onChangeJob = vi.fn();

    render(
      <RubricScreen
        omitted={[]}
        usage={{ inputTokens: 120, outputTokens: 48 }}
        cost={{ totalUsd: 0.008 }}
        criteria={[{ id: "go", kind: "requirement", label: "Go", prompt: "Is there evidence of Go?" }]}
        api={{ approveRubric: async () => undefined }}
        onApproved={() => undefined}
        onChangeJob={onChangeJob}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Change job description" }));
    expect(onChangeJob).toHaveBeenCalledTimes(1);
  });
});

describe("PreviewScreen", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("uploads only kept sections after confirm", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("/v1/evaluations")) {
        return new Response(JSON.stringify({ id: "e1" }), { status: 200 });
      }
      throw new Error(`unexpected ${String(input)}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const evaluate = vi.fn(async (body: { approvedText: string }) => {
      await fetch("http://127.0.0.1:8787/v1/evaluations", {
        method: "POST",
        body: JSON.stringify(body),
      });
      return body;
    });

    render(
      <PreviewScreen
        url="https://www.linkedin.com/in/alex"
        roleTitle="Senior backend"
        sections={previewSections}
        api={{ evaluate }}
        onEvaluated={() => undefined}
      />,
    );

    expect(screen.getByText("Nothing is uploaded until you confirm.")).toBeTruthy();
    expect(
      screen.getByText(
        "Confirming Evaluate sends the approved text to the server, then to Jev and the language model. Nothing is messaged to the candidate.",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Also run direct LLM" })).toHaveProperty("checked", true);
    expect(screen.getByRole("checkbox", { name: "Keep extracts on the server" })).toHaveProperty("checked", false);
    expect(fetchMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Remove About" }));
    await user.click(screen.getByRole("button", { name: "Evaluate" }));

    expect(evaluate).toHaveBeenCalledTimes(1);
    const payload = evaluate.mock.calls[0]?.[0] as { approvedText: string };
    expect(payload.approvedText).toContain("Staff engineer");
    expect(payload.approvedText).toContain("four years");
    expect(payload.approvedText).not.toContain("Builds Go services");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/v1/evaluations");
  });

  it("lets the recruiter read the focused tab again", async () => {
    const user = userEvent.setup();
    const onRecapture = vi.fn();

    render(
      <PreviewScreen
        url="https://www.linkedin.com/in/wrong"
        roleTitle="Senior backend"
        sections={previewSections}
        api={{ evaluate: async () => undefined }}
        onEvaluated={() => undefined}
        onRecapture={onRecapture}
        captureError="Could not read that tab"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Read this tab" }));
    expect(onRecapture).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Could not read that tab")).toBeTruthy();
  });

  it("lets the recruiter start a new job description", async () => {
    const user = userEvent.setup();
    const onChangeJob = vi.fn();

    render(
      <PreviewScreen
        url="https://www.linkedin.com/in/one"
        roleTitle="Senior backend"
        sections={previewSections}
        api={{ evaluate: async () => undefined }}
        onEvaluated={() => undefined}
        onChangeJob={onChangeJob}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Change job description" }));
    expect(onChangeJob).toHaveBeenCalledTimes(1);
  });
});

const jevCost = costFromUsage({ inputTokens: 2180, outputTokens: 36 }, JEV_PRICE);

describe("ResultScreen", () => {
  it("shows the investigate recommendation, certainty lines, and uses remaining", () => {
    render(
      <ResultScreen
        evaluation={{
          id: "e1",
          action: "investigate",
          score: 62,
          reasonCode: "missing_evidence",
          roleTitle: "Senior backend",
          candidateName: "Tim Glaser",
          answers: [
            {
              criterionId: "go",
              label: "Go",
              result: "no_evidence",
              confidence: 0.44,
              excerpt: null,
              llmResult: "match",
              llmConfidence: 0.91,
              llmExcerpt: "Led the payments API in Go for four years.",
            },
          ],
          jev: {
            usage: { inputTokens: 2180, outputTokens: 36 },
            cost: jevCost,
          },
          llm: {
            usage: { inputTokens: 412, outputTokens: 88 },
            cost: { totalUsd: 0.014 },
          },
          usesRemaining: 2,
        }}
        api={{ saveNote: async () => undefined }}
        onRetry={() => undefined}
        onRecapture={() => undefined}
        onChangeJob={() => undefined}
      />,
    );

    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.queryByRole("button", { name: "Contact" })).toBeNull();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Read this tab" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Change job description" })).toBeTruthy();
    expect(
      screen.getByText("A required qualification cannot be confirmed. Missing evidence is not treated as a mismatch."),
    ).toBeTruthy();
    expect(screen.getByText("Role fit 62 of 100")).toBeTruthy();
    expect(screen.getByText("Only certain matches count.")).toBeTruthy();
    expect(screen.getByText("0 of 1 criteria confirmed.")).toBeTruthy();
    expect(
      screen.getByText("Match = found in the profile. No evidence = silent, not a fail. Certain = the policy will use this call."),
    ).toBeTruthy();
    expect(screen.getAllByText("Jev").length).toBeGreaterThan(0);
    expect(screen.getAllByText("LLM").length).toBeGreaterThan(0);
    expect(screen.getByText("– No evidence")).toBeTruthy();
    expect(screen.getByText("Unsure of this call · 0.44")).toBeTruthy();
    expect(screen.getByText("✓ Match")).toBeTruthy();
    expect(screen.getByText("Certain of this call · 0.91")).toBeTruthy();
    expect(screen.queryByRole("meter")).toBeNull();
    expect(screen.getByText("– No evidence").className).toMatch(/chip-no_evidence/);
    expect(screen.getByText("– No evidence").className).toMatch(/chip-unsure/);
    expect(screen.getByText("✓ Match").className).toMatch(/chip-match/);
    expect(screen.getByText("Led the payments API in Go for four years.")).toBeTruthy();
    expect(screen.getByText("Tim Glaser · evaluated for Senior backend")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "This run" })).toBeTruthy();
    expect(screen.getByText("Total $0.014")).toBeTruthy();
    expect(screen.getByText("Read 2,180 tokens")).toBeTruthy();
    expect(screen.getByText("Reported 36 · not billed")).toBeTruthy();
    expect(screen.getByText("Read 412 tokens")).toBeTruthy();
    expect(screen.getByText("Written 88 · on your account")).toBeTruthy();
    expect(screen.getByText("Jev does not write text. Its output tokens are counted and not billed.")).toBeTruthy();
    expect(screen.getByText("Uses remaining: 2 of 3")).toBeTruthy();
  });
});

describe("ErrorScreen", () => {
  it("renders a Jev failure without a recommendation", () => {
    render(
      <ErrorScreen
        error={{ status: 502, body: { error: "jev_failed", reason: "invalid_jev", usesRemaining: 2 } }}
        usesRemaining={2}
      />,
    );

    expect(screen.getByText("Evaluation failed")).toBeTruthy();
    expect(
      screen.getByText(
        "Jev did not return a valid decision. No recommendation was saved, and the comparison was not shown.",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Investigate" })).toBeNull();
  });

  it("renders the trial-cap sentence from a 409 body", () => {
    render(
      <ErrorScreen
        error={{
          status: 409,
          body: { error: "trial_cap", message: "This trial covered three profiles. Evaluate is closed." },
        }}
        usesRemaining={0}
      />,
    );

    expect(screen.getByText("This trial covered three profiles. Evaluate is closed.")).toBeTruthy();
  });

  it("makes Manage usage the primary action when ChatGPT plan usage is exhausted", async () => {
    const user = userEvent.setup();
    const onManageUsage = vi.fn();
    render(
      <ErrorScreen
        error={{ status: 429, body: { error: "subscription_sharing_usage_limit_exceeded" } }}
        onManageUsage={onManageUsage}
        onRetry={() => undefined}
      />,
    );
    expect(screen.getByText("Usage limit reached")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Manage usage" }));
    expect(onManageUsage).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("renders a spend-cap error without blaming Jev or offering Retry", () => {
    render(
      <ErrorScreen
        error={{ status: 503, body: { error: "daily_spend_cap" } }}
        usesRemaining={2}
        onRetry={() => undefined}
      />,
    );

    expect(screen.getByText("Evaluate is closed.")).toBeTruthy();
    expect(screen.getByText("Today's spend limit is reached. Evaluate is closed.")).toBeTruthy();
    expect(
      screen.queryByText(
        "Jev did not return a valid decision. No recommendation was saved, and the comparison was not shown.",
      ),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("renders a kill-switch error without blaming Jev or offering Retry", () => {
    render(
      <ErrorScreen
        error={{ status: 503, body: { error: "evaluations_disabled" } }}
        usesRemaining={2}
        onRetry={() => undefined}
      />,
    );

    expect(screen.getByText("Evaluate is closed.")).toBeTruthy();
    expect(screen.getByText("Evaluate is turned off. No provider call was made.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });
});

describe("EvaluatingScreen", () => {
  it("shows a circular spinner and a waiting status", () => {
    render(<EvaluatingScreen />);

    expect(screen.getByRole("progressbar", { name: "Evaluating" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Evaluating this profile" })).toBeTruthy();
    expect(screen.getByText("Sending the approved profile…")).toBeTruthy();
    expect(screen.getByText("Nothing is messaged to the candidate.")).toBeTruthy();
  });
});

const historyRows = {
  evaluations: [
    {
      id: "e1",
      action: "investigate",
      roleId: "r1",
      roleTitle: "Senior backend",
      candidateName: "Tim Glaser",
      jevTotalUsd: 0.00009156,
      llmTotalUsd: 0.014,
      comparisonEnabled: true,
    },
    {
      id: "e2",
      action: "contact",
      roleTitle: "Staff",
      jevTotalUsd: 0.00009156,
      llmTotalUsd: 0,
      comparisonEnabled: false,
    },
  ],
  totals: { jevUsd: 0.0004, llmUsd: 0.041 },
};

describe("HistoryScreen", () => {
  it("lets the recruiter go back to the result", async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    const list = vi.fn(async () => historyRows);

    render(
      <HistoryScreen usesRemaining={0} api={{ list, deleteAll: async () => undefined }} onBack={onBack} />,
    );

    expect(await screen.findByText("Running total")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Back to result" })).toBeNull();
    const header = document.querySelector(".panel-brand");
    const back = screen.getByRole("button", { name: "Back" });
    expect(header?.lastElementChild).toBe(back);
    expect(back.querySelector("svg")).toBeTruthy();
    await user.click(back);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("shows stored totals, LLM off, and does not increment remaining on delete", async () => {
    const user = userEvent.setup();
    const list = vi.fn(async () => historyRows);
    const deleteAll = vi.fn(async () => {
      list.mockResolvedValueOnce({ evaluations: [], totals: { jevUsd: 0, llmUsd: 0 } });
    });

    render(<HistoryScreen usesRemaining={0} api={{ list, deleteAll }} />);

    expect(await screen.findByText("Running total")).toBeTruthy();
    expect(screen.getByText("Jev $0.0004")).toBeTruthy();
    expect(screen.getByText("LLM $0.041")).toBeTruthy();
    expect(screen.getByText("Totals use the price stored with each run.")).toBeTruthy();
    expect(screen.getByText("Investigate")).toBeTruthy();
    expect(screen.getByText("Tim Glaser · evaluated for Senior backend")).toBeTruthy();
    expect(screen.getByText("Evaluated for Staff")).toBeTruthy();
    expect(screen.getByText("Jev $0.00009 · LLM $0.014")).toBeTruthy();
    expect(screen.getByText("Jev $0.00009 · LLM off")).toBeTruthy();
    expect(screen.getByText("Uses remaining: 0 of 3")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Delete all history" }));

    expect(deleteAll).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Senior backend")).toBeNull();
    expect(screen.getByText("Uses remaining: 0 of 3")).toBeTruthy();
  });

  it("opens a success row and leaves a failed row untappable", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const list = vi.fn(async () => ({
      evaluations: [
        { ...historyRows.evaluations[0], status: "success" },
        {
          id: "e-fail",
          status: "jev_failed",
          action: "",
          roleTitle: "Failed role",
          jevTotalUsd: 0,
          llmTotalUsd: 0,
          comparisonEnabled: true,
        },
      ],
      totals: historyRows.totals,
    }));

    render(
      <HistoryScreen usesRemaining={2} api={{ list, deleteAll: async () => undefined }} onOpen={onOpen} />,
    );

    expect(await screen.findByText("Running total")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Senior backend/ }));
    expect(onOpen).toHaveBeenCalledWith("e1");
    await user.click(screen.getByText("Evaluated for Failed role"));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: /Failed role/ })).toBeNull();
  });
});

describe("keyboard path", () => {
  it("keeps preview extract controls in tab order", () => {
    render(
      <PreviewScreen
        url="https://example.com"
        roleTitle="Role"
        sections={previewSections}
        api={{ evaluate: async () => undefined }}
        onEvaluated={() => undefined}
      />,
    );

    for (const name of ["Remove Headline", "Remove About", "Remove Experience", "Also run direct LLM", "Keep extracts on the server", "Evaluate"]) {
      const role = name.startsWith("Also") || name.startsWith("Keep") ? "checkbox" : "button";
      expect(screen.getByRole(role, { name }).tabIndex).not.toBe(-1);
    }
  });

  it("retries from the result screen", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const onRecapture = vi.fn();
    const onChangeJob = vi.fn();
    render(
      <ResultScreen
        evaluation={{
          id: "e1",
          action: "investigate",
          score: 62,
          reasonCode: "missing_evidence",
          answers: [],
          jev: { usage: { inputTokens: 2180, outputTokens: 36 }, cost: jevCost },
          llm: { usage: { inputTokens: 412, outputTokens: 88 }, cost: { totalUsd: 0.014 } },
          usesRemaining: 2,
        }}
        api={{ saveNote: async () => undefined }}
        onRetry={onRetry}
        onRecapture={onRecapture}
        onChangeJob={onChangeJob}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Retry" }));
    await user.click(screen.getByRole("button", { name: "Read this tab" }));
    await user.click(screen.getByRole("button", { name: "Change job description" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRecapture).toHaveBeenCalledTimes(1);
    expect(onChangeJob).toHaveBeenCalledTimes(1);
  });

  it("returns via header Back and does not expose a footer Back to history", async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    render(
      <ResultScreen
        evaluation={{
          id: "e1",
          action: "investigate",
          score: 62,
          reasonCode: "missing_evidence",
          answers: [],
          jev: { usage: { inputTokens: 2180, outputTokens: 36 }, cost: jevCost },
          llm: { usage: { inputTokens: 412, outputTokens: 88 }, cost: { totalUsd: 0.014 } },
          usesRemaining: 2,
        }}
        api={{ saveNote: async () => undefined }}
        onRetry={() => undefined}
        onBack={onBack}
      />,
    );

    expect(screen.queryByRole("button", { name: "Back to history" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Back to dashboard" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });
});

const dashboardRecent = [
  {
    id: "e1",
    status: "success",
    action: "contact",
    roleTitle: "Staff Software Engineer",
    jevTotalUsd: 0.04,
    llmTotalUsd: 0.03,
    comparisonEnabled: true,
  },
  {
    id: "e2",
    status: "jev_failed",
    action: "investigate",
    roleTitle: "Failed role",
    jevTotalUsd: 0,
    llmTotalUsd: 0,
    comparisonEnabled: true,
  },
] as const;

describe("DashboardScreen", () => {
  it("calls onNewJob from New job description", async () => {
    const user = userEvent.setup();
    const onNewJob = vi.fn();

    render(
      <DashboardScreen
        email="recruiter@example.com"
        usesRemaining={2}
        totals={{ jevUsd: 0.0004, llmUsd: 0.041 }}
        roles={[]}
        recent={[]}
        onNewJob={onNewJob}
        onOpen={() => undefined}
        onSignOut={() => undefined}
      />,
    );

    expect(screen.getByText("Uses remaining: 2 of 3")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "New job description" }));
    expect(onNewJob).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
  });

  it("shows a stored cap of 100 on the dashboard", () => {
    render(
      <DashboardScreen
        email="recruiter@example.com"
        usesRemaining={97}
        cap={100}
        totals={{ jevUsd: 0.0004, llmUsd: 0.041 }}
        roles={[]}
        recent={[]}
        onNewJob={() => undefined}
        onOpen={() => undefined}
        onSignOut={() => undefined}
      />,
    );

    expect(screen.getByText("Uses remaining: 97 of 100")).toBeTruthy();
  });

  it("opens a success recent row and leaves a non-success row untappable", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();

    render(
      <DashboardScreen
        email="recruiter@example.com"
        usesRemaining={2}
        totals={{ jevUsd: 0.0004, llmUsd: 0.041 }}
        roles={[]}
        recent={[...dashboardRecent]}
        onNewJob={() => undefined}
        onOpen={onOpen}
        onSignOut={() => undefined}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Staff Software Engineer/ }));
    expect(onOpen).toHaveBeenCalledWith("e1");
    await user.click(screen.getByText("Evaluated for Failed role"));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: /Failed role/ })).toBeNull();
  });

  it("calls onSignOut from Sign out", async () => {
    const user = userEvent.setup();
    const onSignOut = vi.fn();

    render(
      <DashboardScreen
        email="recruiter@example.com"
        usesRemaining={2}
        totals={{ jevUsd: 0.0004, llmUsd: 0.041 }}
        roles={[]}
        recent={[]}
        onNewJob={() => undefined}
        onOpen={() => undefined}
        onSignOut={onSignOut}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Sign out" }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it("shows Continue only when a sitting is passed in", () => {
    const { rerender } = render(
      <DashboardScreen
        email="recruiter@example.com"
        usesRemaining={2}
        totals={{ jevUsd: 0.0004, llmUsd: 0.041 }}
        roles={[]}
        recent={[]}
        onNewJob={() => undefined}
        onOpen={() => undefined}
        onSignOut={() => undefined}
      />,
    );

    expect(screen.queryByRole("button", { name: /Continue/ })).toBeNull();

    rerender(
      <DashboardScreen
        email="recruiter@example.com"
        usesRemaining={2}
        totals={{ jevUsd: 0.0004, llmUsd: 0.041 }}
        sitting={{ title: "Staff Software Engineer" }}
        roles={[]}
        recent={[]}
        onNewJob={() => undefined}
        onOpen={() => undefined}
        onSignOut={() => undefined}
      />,
    );

    expect(screen.getByRole("button", { name: /Continue/ })).toBeTruthy();
    expect(screen.getByText("Staff Software Engineer")).toBeTruthy();
  });

  it("shows company and a short job description on a saved role", () => {
    render(
      <DashboardScreen
        email="recruiter@example.com"
        usesRemaining={2}
        totals={{ jevUsd: 0.0004, llmUsd: 0.041 }}
        roles={[
          {
            id: "r1",
            title: "Forward Deployed Engineer",
            company: "AIM",
            summary: "AIM is a deep-tech startup building evaluation systems.",
          },
        ]}
        recent={[]}
        onNewJob={() => undefined}
        onOpen={() => undefined}
        onSignOut={() => undefined}
      />,
    );

    expect(screen.getByRole("button", { name: /^Forward Deployed Engineer/ })).toBeTruthy();
    expect(screen.getByText("AIM")).toBeTruthy();
    expect(screen.getByText("AIM is a deep-tech startup building evaluation systems.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Clear history" })).toBeNull();
    expect(screen.queryByText("No evaluations yet.")).toBeNull();
    expect(screen.queryByRole("heading", { name: "History" })).toBeNull();
    expect(screen.getByRole("button", { name: "Delete all history" })).toBeTruthy();
  });

  it("disables Delete all history when there are no saved roles", () => {
    render(
      <DashboardScreen
        email="recruiter@example.com"
        usesRemaining={2}
        totals={{ jevUsd: 0.0004, llmUsd: 0.041 }}
        roles={[]}
        recent={[]}
        onNewJob={() => undefined}
        onOpen={() => undefined}
        onDeleteRoles={() => undefined}
        onSignOut={() => undefined}
      />,
    );

    expect((screen.getByRole("button", { name: "Delete all history" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("opens a saved role without listing that role's evaluations on the card", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const onOpenRole = vi.fn();

    render(
      <DashboardScreen
        email="recruiter@example.com"
        usesRemaining={2}
        totals={{ jevUsd: 0.0004, llmUsd: 0.041 }}
        roles={[
          {
            id: "r1",
            title: "Forward Deployed Engineer",
            company: "AIM",
            summary: "AIM is a deep-tech startup building evaluation systems.",
          },
        ]}
        recent={[
          {
            id: "e1",
            status: "success",
            action: "contact",
            roleId: "r1",
            roleTitle: "Forward Deployed Engineer",
            candidateName: "Tim Glaser",
            jevTotalUsd: 0.04,
            llmTotalUsd: 0.03,
            comparisonEnabled: true,
          },
        ]}
        onNewJob={() => undefined}
        onOpenRole={onOpenRole}
        onOpen={onOpen}
        onSignOut={() => undefined}
      />,
    );

    expect(screen.queryByRole("button", { name: "Clear history" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "History" })).toBeNull();
    expect(screen.getByText("Tim Glaser · evaluated for Forward Deployed Engineer")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /^Forward Deployed Engineer/ }));
    expect(onOpenRole).toHaveBeenCalledWith("r1");
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("deletes every saved role from one button without opening a role", async () => {
    const user = userEvent.setup();
    const onDeleteRoles = vi.fn();
    const onOpenRole = vi.fn();

    render(
      <DashboardScreen
        email="recruiter@example.com"
        usesRemaining={2}
        totals={{ jevUsd: 0.0004, llmUsd: 0.041 }}
        roles={[
          {
            id: "r1",
            title: "Forward Deployed Engineer",
            company: "AIM",
            summary: "AIM is a deep-tech startup building evaluation systems.",
          },
        ]}
        recent={[]}
        onNewJob={() => undefined}
        onOpenRole={onOpenRole}
        onOpen={() => undefined}
        onDeleteRoles={onDeleteRoles}
        onSignOut={() => undefined}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Delete all history" }));
    expect(onDeleteRoles).toHaveBeenCalledTimes(1);
    expect(onOpenRole).not.toHaveBeenCalled();
  });

  it("shows the role and LinkedIn name on a recent evaluation", () => {
    render(
      <DashboardScreen
        email="recruiter@example.com"
        usesRemaining={2}
        totals={{ jevUsd: 0.0004, llmUsd: 0.041 }}
        roles={[]}
        recent={[{ ...dashboardRecent[0], candidateName: "Tim Glaser" }]}
        onNewJob={() => undefined}
        onOpen={() => undefined}
        onSignOut={() => undefined}
      />,
    );

    expect(screen.getByText("Tim Glaser · evaluated for Staff Software Engineer")).toBeTruthy();
  });
});

describe("SittingScreen", () => {
  it("shows the job description and rubric on a saved sitting", () => {
    render(
      <SittingScreen
        roleTitle="Forward Deployed Engineer"
        company="AIM"
        jobDescription="AIM is a deep-tech startup building evaluation systems for hiring teams."
        criteria={[{ id: "go", kind: "requirement", label: "Go", prompt: "Is there evidence of Go?" }]}
        onReadTab={() => undefined}
        onChangeJob={() => undefined}
        onBack={() => undefined}
      />,
    );

    expect(screen.getByRole("heading", { name: "Job description" })).toBeTruthy();
    expect(screen.getByText(/deep-tech startup/)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Rubric" })).toBeTruthy();
    expect(screen.getByText("Go")).toBeTruthy();
    expect(screen.getByText("Is there evidence of Go?")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Read this tab" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Change job description" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Back to dashboard" })).toBeNull();
    const header = document.querySelector(".panel-brand");
    const back = screen.getByRole("button", { name: "Back" });
    expect(header?.lastElementChild).toBe(back);
    expect(back.querySelector("svg")).toBeTruthy();
  });
});
