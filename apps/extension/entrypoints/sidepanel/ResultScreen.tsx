import { formatUsd, type Action, type ReasonCode } from "@decision-assistant/domain";
import { useState } from "react";
import {
  certaintyCopy,
  chipTone,
  isCertain,
  isConfirmedMatch,
  evaluatedForCopy,
  PRODUCT_NAME,
  reasonCopy,
  usesRemainingCopy,
  resultLabel,
  resultMark,
} from "../../src/copy";
import { PanelHeader } from "./PanelHeader";

const ACTIONS: { id: Action; name: string }[] = [
  { id: "contact", name: "Contact" },
  { id: "investigate", name: "Investigate" },
  { id: "save_for_later", name: "Save for later" },
  { id: "skip", name: "Skip" },
];

export type ResultAnswer = {
  criterionId: string;
  label?: string;
  result: string;
  confidence: number;
  excerpt: null;
  llmResult?: string | null;
  llmConfidence?: number | null;
  llmExcerpt: string | null;
};

export type ResultEvaluation = {
  id: string;
  action: Action;
  score: number;
  reasonCode: ReasonCode;
  roleTitle?: string;
  candidateName?: string;
  answers: ResultAnswer[];
  jev: { usage: { inputTokens: number; outputTokens: number }; cost: { totalUsd: number } } | null;
  llm: { usage: { inputTokens: number; outputTokens: number }; cost: { totalUsd: number } } | null;
  usesRemaining: number | null;
};

function formatTokens(count: number): string {
  return count.toLocaleString("en-US");
}

function UsageCol({
  name,
  model,
  outputLabel,
}: {
  name: string;
  model: { usage: { inputTokens: number; outputTokens: number }; cost: { totalUsd: number } } | null;
  outputLabel: string;
}) {
  if (!model) {
    return (
      <div className="compare-col">
        <p className="compare-label">{name}</p>
        <p className="lede">Off</p>
      </div>
    );
  }
  return (
    <div className="compare-col">
      <p className="compare-label">{name}</p>
      <p className="fit">{formatUsd(model.cost.totalUsd)}</p>
      <p>Read {formatTokens(model.usage.inputTokens)} tokens</p>
      <p>{outputLabel}</p>
    </div>
  );
}

function CallCard({ name, result, confidence }: { name: string; result: string; confidence: number }) {
  const tone = chipTone(result);
  const unsure = !isCertain(confidence);
  return (
    <div className="compare-col">
      <p className="compare-label">{name}</p>
      <p className={`chip chip-${tone}${unsure ? " chip-unsure" : ""}`}>
        {resultMark(result)} {resultLabel(result)}
      </p>
      <p className="lede">{certaintyCopy(confidence)}</p>
    </div>
  );
}

export function ResultScreen({
  evaluation,
  roleTitle = "Result",
  api,
  onRetry,
  onRecapture,
  onChangeJob,
  captureError,
  onOpenHistory,
  onBack,
  cap = 3,
  billing,
}: {
  evaluation: ResultEvaluation;
  roleTitle?: string;
  api: {
    saveNote: (id: string, notes: string) => Promise<unknown>;
  };
  onRetry: () => void;
  onRecapture?: () => void;
  onChangeJob?: () => void;
  captureError?: string;
  onOpenHistory?: () => void;
  onBack?: () => void;
  cap?: number | null;
  billing?: string;
}) {
  const [note, setNote] = useState("");
  const actionTitle = ACTIONS.find((item) => item.id === evaluation.action)?.name ?? "Result";
  const confirmed = evaluation.answers.filter((answer) => isConfirmedMatch(answer.result, answer.confidence)).length;
  const jevUsd = evaluation.jev?.cost.totalUsd ?? 0;
  const llmUsd = evaluation.llm?.cost.totalUsd ?? 0;
  const runTotal = jevUsd + llmUsd;
  const llmShare = runTotal > 0 ? Math.round((100 * llmUsd) / runTotal) : 0;
  const jevShare = runTotal > 0 ? 100 - llmShare : 0;

  return (
    <section className="panel">
      <PanelHeader title={PRODUCT_NAME} subtitle={roleTitle} onBack={onBack} />
      <div>
        <h2>{actionTitle}</h2>
        {evaluatedForCopy(
          evaluation.roleTitle ?? (roleTitle === "Result" ? undefined : roleTitle),
          evaluation.candidateName,
        ) ? (
          <p className="lede">
            {evaluatedForCopy(
              evaluation.roleTitle ?? (roleTitle === "Result" ? undefined : roleTitle),
              evaluation.candidateName,
            )}
          </p>
        ) : null}
        <p className="lede">{reasonCopy(evaluation.reasonCode)}</p>
        {billing ? <p className="lede">{billing}</p> : null}
        <p className="fit">Role fit {evaluation.score} of 100</p>
        <p className="lede">Only certain matches count.</p>
        <p className="lede">
          {confirmed} of {evaluation.answers.length} criteria confirmed.
        </p>
      </div>
      <p className="lede">
        Match = found in the profile. No evidence = silent, not a fail. Certain = the policy will use this call.
      </p>
      <div className="stack">
        <button className="primary" type="button" onClick={onRetry}>
          Retry
        </button>
        {onRecapture ? (
          <button className="secondary" type="button" onClick={onRecapture}>
            Read this tab
          </button>
        ) : null}
        {onChangeJob ? (
          <button className="secondary" type="button" onClick={onChangeJob}>
            Change job description
          </button>
        ) : null}
        {captureError ? <p className="error">{captureError}</p> : null}
      </div>
      {evaluation.answers.map((answer) => {
        const hasLlm = answer.llmResult != null && answer.llmConfidence != null;
        const disagree = hasLlm && answer.llmResult !== answer.result;
        return (
          <article className="card" key={answer.criterionId}>
            <h3>{answer.label ?? answer.criterionId}</h3>
            <div className={disagree ? "compare-row compare-disagree" : "compare-row"}>
              <CallCard name="Jev" result={answer.result} confidence={answer.confidence} />
              {hasLlm ? (
                <CallCard name="LLM" result={answer.llmResult ?? ""} confidence={answer.llmConfidence ?? 0} />
              ) : (
                <div className="compare-col">
                  <p className="compare-label">LLM</p>
                  <p className="lede">Off</p>
                </div>
              )}
            </div>
            {answer.llmExcerpt ? <p>{answer.llmExcerpt}</p> : null}
          </article>
        );
      })}
      <article className="card">
        <h3>This run</h3>
        <p className="fit">Total {formatUsd(runTotal)}</p>
        {evaluation.llm && llmUsd >= jevUsd ? <p className="lede">Most of the cost is the language model.</p> : null}
        {runTotal > 0 ? (
          <>
            <div
              className="usage-share"
              role="img"
              aria-label={`Jev ${jevShare}% of spend, LLM ${llmShare}% of spend`}
            >
              <span className="usage-share-jev" style={{ width: `${jevShare}%` }} />
              <span className="usage-share-llm" style={{ width: `${llmShare}%` }} />
            </div>
            <p className="lede">
              Jev {jevShare}% · LLM {llmShare}% of spend
            </p>
          </>
        ) : null}
        <div className="compare-row">
          <UsageCol
            name="Jev"
            model={evaluation.jev}
            outputLabel={
              evaluation.jev
                ? `Reported ${formatTokens(evaluation.jev.usage.outputTokens)} · not billed`
                : ""
            }
          />
          <UsageCol
            name="LLM"
            model={evaluation.llm}
            outputLabel={
              evaluation.llm ? `Written ${formatTokens(evaluation.llm.usage.outputTokens)} · on your account` : ""
            }
          />
        </div>
        <p className="lede">Jev does not write text. Its output tokens are counted and not billed.</p>
        <p>
          {usesRemainingCopy(evaluation.usesRemaining, cap)}
        </p>
      </article>
      <textarea
        placeholder="Add a note. Nothing is sent to the candidate."
        value={note}
        onChange={(event) => setNote(event.target.value)}
        onBlur={() => {
          void api.saveNote(evaluation.id, note);
        }}
      />
      {onOpenHistory ? (
        <button className="linkish" type="button" onClick={onOpenHistory}>
          History
        </button>
      ) : null}
    </section>
  );
}
