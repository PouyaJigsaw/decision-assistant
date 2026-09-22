/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PreviewScreen } from "./PreviewScreen";
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
