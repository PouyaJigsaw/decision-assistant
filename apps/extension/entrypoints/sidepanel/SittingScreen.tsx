import { PRODUCT_NAME } from "../../src/copy";
import { PanelHeader } from "./PanelHeader";
import type { DraftResult } from "./RoleScreen";

const KIND_LABELS = {
  requirement: "Required",
  preference: "Preferred",
  disqualifier: "Disqualifier",
  seniority: "Seniority",
} as const;

export function SittingScreen({
  roleTitle,
  company,
  jobDescription,
  criteria,
  onReadTab,
  onChangeJob,
  onBack,
  captureError,
}: {
  roleTitle: string;
  company?: string;
  jobDescription: string;
  criteria: DraftResult["criteria"];
  onReadTab: () => void;
  onChangeJob: () => void;
  onBack: () => void;
  captureError?: string;
}) {
  return (
    <section className="panel">
      <PanelHeader title={PRODUCT_NAME} subtitle={roleTitle} onBack={onBack} />
      {company ? <p className="lede">{company}</p> : null}
      <div className="stack">
        <h2>Job description</h2>
        <p className="job-notes">{jobDescription || "No job description stored for this role yet."}</p>
      </div>
      <div className="stack">
        <h2>Rubric</h2>
        {criteria.map((row) => (
          <article className="card" key={row.id}>
            <p className="pill">{KIND_LABELS[row.kind]}</p>
            <h3>{row.label}</h3>
            <p>{row.prompt}</p>
          </article>
        ))}
      </div>
      <button className="primary" type="button" onClick={onReadTab}>
        Read this tab
      </button>
      <button className="secondary" type="button" onClick={onChangeJob}>
        Change job description
      </button>
      {captureError ? <p className="error">{captureError}</p> : null}
    </section>
  );
}
