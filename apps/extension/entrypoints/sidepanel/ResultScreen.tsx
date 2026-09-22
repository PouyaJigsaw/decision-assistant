import { formatUsd, type Action, type ReasonCode } from "@decision-assistant/domain";
import { useState, type KeyboardEvent } from "react";
import { chipLabel, reasonCopy } from "../../src/copy";
import { PanelHeader } from "./PanelHeader";

const ACTIONS: { id: Action; label: string; name: string }[] = [
  { id: "contact", label: "Contact", name: "Contact" },
  { id: "investigate", label: "Investigate", name: "Investigate" },
  { id: "save_for_later", label: "Save", name: "Save for later" },
  { id: "skip", label: "Skip", name: "Skip" },
];

export type ResultAnswer = {
  criterionId: string;
  label?: string;
  result: string;
  confidence: number;
  excerpt: null;
  llmExcerpt: string | null;
};

export type ResultEvaluation = {
  id: string;
  action: Action;
  score: number;
  reasonCode: ReasonCode;
  answers: ResultAnswer[];
  jev: { usage: { inputTokens: number; outputTokens: number }; cost: { totalUsd: number } } | null;
  llm: { usage: { inputTokens: number; outputTokens: number }; cost: { totalUsd: number } } | null;
  usesRemaining: number;
};

export function ResultScreen({
  evaluation,
  roleTitle = "Result",
  api,
  onOpenHistory,
}: {
  evaluation: ResultEvaluation;
  roleTitle?: string;
  api: {
    correct: (id: string, action: Action) => Promise<unknown>;
    saveNote: (id: string, notes: string) => Promise<unknown>;
  };
  onOpenHistory?: () => void;
}) {
  const [checked, setChecked] = useState<Action>(evaluation.action);
  const [note, setNote] = useState("");
  const actionTitle = ACTIONS.find((item) => item.id === evaluation.action)?.name ?? "Result";

  function move(delta: number) {
    const index = ACTIONS.findIndex((item) => item.id === checked);
    const next = ACTIONS[(index + delta + ACTIONS.length) % ACTIONS.length];
    if (next) setChecked(next.id);
  }

  function handleKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      move(1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      move(-1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      void api.correct(evaluation.id, checked);
    }
  }

  return (
    <section className="panel">
      <PanelHeader title="Decision Assistant" subtitle={roleTitle} />
      <div>
        <h2>{actionTitle}</h2>
        <p className="lede">{reasonCopy(evaluation.reasonCode)}</p>
        <p className="score">{evaluation.score}</p>
      </div>
      <div role="radiogroup" aria-label="Recommended action" tabIndex={0} onKeyDown={handleKey} className="actions">
        {ACTIONS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="radio"
            aria-checked={checked === item.id}
            aria-label={item.name}
            className={checked === item.id ? "action checked" : "action"}
            onClick={() => setChecked(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {evaluation.answers.map((answer) => (
        <article className="card" key={answer.criterionId}>
          <h3>{answer.label ?? answer.criterionId}</h3>
          <p className="chip">{chipLabel(answer.result, answer.confidence)}</p>
          <p>Jev does not return text.</p>
          <p>{answer.llmExcerpt ?? "No evidence found."}</p>
        </article>
      ))}
      <article className="card">
        {evaluation.jev ? (
          <p>
            Jev {evaluation.jev.usage.inputTokens} in · {evaluation.jev.usage.outputTokens} out ·{" "}
            {formatUsd(evaluation.jev.cost.totalUsd)}
          </p>
        ) : null}
        {evaluation.llm ? (
          <p>
            LLM {evaluation.llm.usage.inputTokens} in · {evaluation.llm.usage.outputTokens} out ·{" "}
            {formatUsd(evaluation.llm.cost.totalUsd)}
          </p>
        ) : (
          <p>LLM off</p>
        )}
        <p>Jev output tokens are reported and not billed. They are not generated text.</p>
        <p>Uses remaining: {evaluation.usesRemaining} of 3</p>
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
