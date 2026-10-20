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

function answerMark(tone: "match" | "mismatch" | "no_evidence"): string {
  if (tone === "match") return "✓";
  if (tone === "mismatch") return "×";
  return "–";
}

function AnswerCard({
  kind,
  result,
  confidence,
}: {
  kind?: Criterion["kind"];
  result: string;
  confidence: number;
}) {
  const presented = presentAnswer({ kind, result, confidence });
  return (
    <div>
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
  onHome,
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
  onHome?: () => void;
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
      {evaluation.answers.map((answer) => (
        <article className="card" key={answer.criterionId}>
          <h3>{answer.label ?? answer.criterionId}</h3>
          {answer.prompt ? <ScreeningPrompt prompt={answer.prompt} /> : null}
          <AnswerCard kind={answer.kind} result={answer.result} confidence={answer.confidence} />
        </article>
      ))}
      <article className="card">
        <h3>This run</h3>
        <p className="fit">Total {formatUsd(jevUsd)}</p>
        {evaluation.jev ? (
          <>
            <p>Read {formatTokens(evaluation.jev.usage.inputTokens)} tokens</p>
            <p>Reported {formatTokens(evaluation.jev.usage.outputTokens)} · not billed</p>
          </>
        ) : null}
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
      {onHome ? (
        <button className="secondary" type="button" onClick={onHome}>
          Home
        </button>
      ) : null}
    </section>
  );
}
