import { useState, type FormEvent } from "react";
import { ApiError } from "../../src/api";
import { PRODUCT_NAME } from "../../src/copy";
import { PanelHeader } from "./PanelHeader";

export type DraftResult = {
  criteria: { id: string; kind: "requirement" | "preference" | "disqualifier" | "seniority"; label: string; prompt: string }[];
  omitted: string[];
  usage: { inputTokens: number; outputTokens: number };
  cost: { totalUsd: number };
};

export const MIN_JOB_DESCRIPTION_WORDS = 150;
export const INSUFFICIENT_JOB_DESCRIPTION =
  "This job description is not sufficient. Paste the full posting — at least 150 words.";

export function jobDescriptionWordCount(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function RoleScreen({
  api,
  onDrafted,
  initialNotes = "",
  billing,
  onBack,
}: {
  api: { draftRubric: (notes: string) => Promise<DraftResult> };
  onDrafted: (draft: DraftResult) => void;
  initialNotes?: string;
  billing?: string;
  onBack?: () => void;
}) {
  const [notes, setNotes] = useState(initialNotes);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (jobDescriptionWordCount(notes) < MIN_JOB_DESCRIPTION_WORDS) {
      setError(INSUFFICIENT_JOB_DESCRIPTION);
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      onDrafted(await api.draftRubric(notes));
    } catch (caught) {
      setError(draftErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <PanelHeader title={PRODUCT_NAME} onBack={onBack} />
      <div>
        <h2>Create a role</h2>
        <p className="lede">
          Paste a job description. The comparison model drafts an editable rubric. Jev does not write text.
        </p>
        {billing ? <p className="lede">{billing}</p> : null}
      </div>
      <form className="stack" onSubmit={handleSubmit}>
        <label className="stack">
          <span className="field-label">Job description</span>
          <textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
        </label>
        <button className="primary" type="submit" disabled={busy}>
          Draft rubric
        </button>
        {error ? <p className="error">{error}</p> : null}
      </form>
    </section>
  );
}

function draftErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message === "llm_not_connected") {
    return "Connect ChatGPT or an API key to draft a rubric.";
  }
  if (error instanceof ApiError) {
    const code =
      error.body && typeof error.body === "object" && "error" in error.body
        ? String((error.body as { error: unknown }).error)
        : "";
    if (code === "insufficient_notes" || error.status === 422) {
      return INSUFFICIENT_JOB_DESCRIPTION;
    }
    if (code === "llm_failed" || error.status === 502) {
      return "The comparison model did not finish a rubric. Nothing was sent to Jev. Wait and try again.";
    }
    if (code === "llm_not_connected") {
      return "Connect ChatGPT or an API key to draft a rubric.";
    }
    if (code === "invalid_rubric") {
      return "The model returned no usable criteria. Edit the job description and try again.";
    }
    if (error.status === 401) {
      return "Sign in expired. Sign in again, then draft the rubric.";
    }
  }
  return "Could not draft the rubric. The job description is still here — try again.";
}
