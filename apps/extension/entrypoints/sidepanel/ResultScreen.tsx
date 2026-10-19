import {
  formatUsd,
  presentAnswer,
  splitScreeningPrompt,
  type Action,
  type Criterion,
  type ReasonCode,
} from "@decision-assistant/domain";
import { useState } from "react";
import {
  ANSWER_MEANINGS,
  certaintyCopy,
  isConfirmedMatch,
  evaluatedForCopy,
  PRODUCT_NAME,
  reasonCopy,
  usesRemainingCopy,
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
  prompt?: string;
  kind?: Criterion["kind"];
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

function ScreeningPrompt({ prompt }: { prompt: string }) {
  const screening = splitScreeningPrompt(prompt);
  return (
    <>
      <p className="screening-question">{screening.question}</p>
      {screening.evidence ? <p className="evidence-guidance">{screening.evidence}</p> : null}
    </>
  );
}

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

function answerMark(tone: "match" | "mismatch" | "no_evidence"): string {
  if (tone === "match") return "✓";
  if (tone === "mismatch") return "×";
  return "–";
}

function CallCard({
  name,
  kind,
  result,
  confidence,
}: {
  name: string;
  kind?: Criterion["kind"];
  result: string;
  confidence: number;
}) {
  const presented = presentAnswer({ kind, result, confidence });
  return (
    <div className="compare-col">
      <p className="compare-label">{name}</p>
      <p className={`chip chip-${presented.tone}${presented.uncertain ? " chip-unsure" : ""}`}>
        {answerMark(presented.tone)} {presented.label}
      </p>
      {presented.detail ? <p className="lede">{presented.detail}</p> : null}
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
  const confirmed = evaluation.answers.filter((answer) =>
    isConfirmedMatch(answer.result, answer.confidence, answer.kind),
  ).length;
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
        {ANSWER_MEANINGS}
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
            {answer.prompt ? <ScreeningPrompt prompt={answer.prompt} /> : null}
            <div className={disagree ? "compare-row compare-disagree" : "compare-row"}>
              <CallCard name="Jev" kind={answer.kind} result={answer.result} confidence={answer.confidence} />
              {hasLlm ? (
                <CallCard
                  name="LLM"
                  kind={answer.kind}
                  result={answer.llmResult ?? ""}
                  confidence={answer.llmConfidence ?? 0}
                />
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
