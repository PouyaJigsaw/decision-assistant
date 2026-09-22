import { formatUsd } from "@decision-assistant/domain";
import { useState, type FormEvent } from "react";
import { ApiError } from "../../src/api";
import { PanelHeader } from "./PanelHeader";
import type { DraftResult } from "./RoleScreen";

const KIND_LABELS = {
  requirement: "Required",
  preference: "Preferred",
  disqualifier: "Disqualifier",
  seniority: "Seniority",
} as const;

type Criterion = DraftResult["criteria"][number];

export function RubricScreen({
  criteria,
  omitted,
  usage,
  cost,
  roleTitle = "Review the rubric",
  api,
  onApproved,
}: {
  criteria: Criterion[];
  omitted: string[];
  usage: { inputTokens: number; outputTokens: number };
  cost: { totalUsd: number };
  roleTitle?: string;
  api: { approveRubric: (criteria: Criterion[]) => Promise<unknown> };
  onApproved: () => void;
}) {
  const [rows, setRows] = useState(criteria);
  const [safety, setSafety] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  function update(index: number, patch: Partial<Criterion>) {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setSafety(undefined);
    try {
      await api.approveRubric(rows);
      onApproved();
    } catch (error) {
      if (error instanceof ApiError && error.status === 422) {
        const term = typeof error.body === "object" && error.body && "term" in error.body ? String(error.body.term) : "";
        if (term) setSafety(`Protected term: ${term}`);
        return;
      }
      throw error;
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <PanelHeader title="Decision Assistant" subtitle={roleTitle} />
      <div>
        <h2>Review the rubric</h2>
        <p className="lede">Edit the wording and the kind. Approving creates version 1. Protected criteria are omitted.</p>
      </div>
      {omitted.length > 0 ? <p className="omitted">Omitted: {omitted.join(", ")}</p> : null}
      <form className="stack" onSubmit={handleSubmit}>
        {rows.map((row, index) => (
          <div className="card" key={row.id}>
            <label className="stack">
              <span className="field-label">Kind</span>
              <select
                className="pill"
                value={row.kind}
                onChange={(event) => update(index, { kind: event.target.value as Criterion["kind"] })}
              >
                {Object.entries(KIND_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="stack">
              <span className="field-label">Label</span>
              <input value={row.label} onChange={(event) => update(index, { label: event.target.value })} />
            </label>
            <label className="stack">
              <span className="field-label">Prompt</span>
              <input value={row.prompt} onChange={(event) => update(index, { prompt: event.target.value })} />
            </label>
          </div>
        ))}
        {safety ? <p className="error">{safety}</p> : null}
        <button className="primary" type="submit" disabled={busy}>
          Approve rubric
        </button>
      </form>
      <p className="meter">
        Rubric draft · {usage.inputTokens} in · {usage.outputTokens} out · {formatUsd(cost.totalUsd)}
      </p>
    </section>
  );
}
