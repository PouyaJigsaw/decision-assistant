/** @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RoleScreen } from "./RoleScreen";
import { RubricScreen } from "./RubricScreen";

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
