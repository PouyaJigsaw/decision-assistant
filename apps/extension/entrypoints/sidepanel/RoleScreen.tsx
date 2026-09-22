import { useState, type FormEvent } from "react";
import { PanelHeader } from "./PanelHeader";

export type DraftResult = {
  criteria: { id: string; kind: "requirement" | "preference" | "disqualifier" | "seniority"; label: string; prompt: string }[];
  omitted: string[];
  usage: { inputTokens: number; outputTokens: number };
  cost: { totalUsd: number };
};

export function RoleScreen({
  api,
  onDrafted,
}: {
  api: { draftRubric: (notes: string) => Promise<DraftResult> };
  onDrafted: (draft: DraftResult) => void;
}) {
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      onDrafted(await api.draftRubric(notes));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <PanelHeader title="Decision Assistant" subtitle="Local backbone" />
      <div>
        <h2>Create a role</h2>
        <p className="lede">
          Paste a job description. The comparison model drafts an editable rubric. Jev does not write text.
        </p>
      </div>
      <form className="stack" onSubmit={handleSubmit}>
        <label className="stack">
          <span className="field-label">Job description</span>
          <textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
        </label>
        <button className="primary" type="submit" disabled={busy}>
          Draft rubric
        </button>
      </form>
    </section>
  );
}
