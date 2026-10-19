import { splitScreeningPrompt } from "@decision-assistant/domain";
import { IMPORTANCE_LABELS, PRODUCT_NAME, roleHeading } from "../../src/copy";
import { PanelHeader } from "./PanelHeader";
import type { DraftResult } from "./RoleScreen";

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
      <PanelHeader title={PRODUCT_NAME} subtitle={roleHeading(roleTitle, company) || roleTitle} onBack={onBack} />
      <div className="stack">
        <h2>Job description</h2>
        <p className="job-notes">{jobDescription || "No job description stored for this role yet."}</p>
      </div>
      <div className="stack">
        <h2>Rubric</h2>
        {criteria.map((row) => {
          const screening = splitScreeningPrompt(row.prompt);
          return (
            <article className="card" key={row.id}>
              <p className="pill">{IMPORTANCE_LABELS[row.kind]}</p>
              <h3>{row.label}</h3>
              <p className="screening-question">{screening.question}</p>
              {screening.evidence ? <p className="evidence-guidance">{screening.evidence}</p> : null}
            </article>
          );
        })}
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
