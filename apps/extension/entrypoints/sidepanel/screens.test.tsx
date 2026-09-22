/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JEV_PRICE, costFromUsage } from "@decision-assistant/domain";
import { ErrorScreen } from "./ErrorScreen";
import { EvaluatingScreen } from "./EvaluatingScreen";
import { PreviewScreen } from "./PreviewScreen";
import { ResultScreen } from "./ResultScreen";
import { RoleScreen } from "./RoleScreen";
import { RubricScreen } from "./RubricScreen";

afterEach(() => {
  cleanup();
});

const previewSections = [
  { id: "headline", title: "Headline", text: "Staff engineer" },
  { id: "about", title: "About", text: "Builds Go services" },
  { id: "experience", title: "Experience", text: "four years" },
];

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

    await user.type(screen.getByLabelText("Job description"), "Need a staff Go engineer");
    await user.click(screen.getByRole("button", { name: "Draft rubric" }));

    expect(draftRubric).toHaveBeenCalledWith("Need a staff Go engineer");
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
      />,
    );

    expect(screen.getByText("Omitted: age")).toBeTruthy();

    await user.clear(screen.getByDisplayValue("Is there evidence of Go?"));
    await user.type(screen.getByLabelText("Prompt"), "edited prompt");
    await user.click(screen.getByRole("button", { name: "Approve rubric" }));

    expect(approveRubric).toHaveBeenCalledWith([
      { id: "go", kind: "requirement", label: "Go", prompt: "edited prompt" },
    ]);
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
});

const jevCost = costFromUsage({ inputTokens: 2180, outputTokens: 36 }, JEV_PRICE);

describe("ResultScreen", () => {
  it("shows the investigate recommendation, both meters, and uses remaining", () => {
    render(
      <ResultScreen
        evaluation={{
          id: "e1",
          action: "investigate",
          score: 62,
          reasonCode: "missing_evidence",
          answers: [
            {
              criterionId: "go",
              label: "Go",
              result: "no_evidence",
              confidence: 0.44,
              excerpt: null,
              llmExcerpt: null,
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
        api={{ correct: async () => undefined, saveNote: async () => undefined }}
      />,
    );

    expect(
      screen.getByText("A required qualification cannot be confirmed. Missing evidence is not treated as a mismatch."),
    ).toBeTruthy();
    expect(screen.getByText("62")).toBeTruthy();
    expect(screen.getByText("No evidence · 0.44")).toBeTruthy();
    expect(screen.getByText("Jev does not return text.")).toBeTruthy();
    expect(screen.getByText("No evidence found.")).toBeTruthy();
    expect(
      screen.getByText("Jev output tokens are reported and not billed. They are not generated text."),
    ).toBeTruthy();
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
});

describe("EvaluatingScreen", () => {
  it("explains the one-pass Jev call and fail-closed path", () => {
    render(<EvaluatingScreen />);

    expect(
      screen.getByText(
        "Jev answers every criterion in one pass. The action is computed locally and is not shown until that call succeeds.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("A failed Jev call shows an error and no recommendation.")).toBeTruthy();
  });
});
