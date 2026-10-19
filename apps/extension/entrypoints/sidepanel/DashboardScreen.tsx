import { formatUsd, type Action } from "@decision-assistant/domain";
import { evaluatedForCopy, PRODUCT_NAME, usesRemainingCopy } from "../../src/copy";
import type { HistoryRow } from "./HistoryScreen";
import { PanelHeader } from "./PanelHeader";

const ACTION_LABEL: Record<Action, string> = {
  contact: "Contact",
  investigate: "Investigate",
  save_for_later: "Save for later",
  skip: "Skip",
};

export function DashboardScreen({
  email,
  usesRemaining,
  cap = 3,
  totals,
  sitting,
  roles,
  recent,
  error,
  onNewJob,
  onModel,
  onContinue,
  onOpenRole,
  onOpen,
  onHistory,
  onDeleteRoles,
  onSignOut,
}: {
  email: string;
  usesRemaining: number | null;
  cap?: number | null;
  totals: { jevUsd: number; llmUsd: number };
  sitting?: { title: string } | null;
  roles: { id: string; title: string; company?: string; summary?: string }[];
  recent: HistoryRow[];
  error?: string;
  onModel?: () => void;
  onNewJob: () => void;
  onContinue?: () => void;
  onOpenRole?: (id: string) => void;
  onOpen: (id: string) => void;
  onHistory?: () => void;
  onDeleteRoles?: () => void;
  onSignOut: () => void;
}) {
  return (
    <section className="panel">
      <PanelHeader title={PRODUCT_NAME} subtitle={email} />
      <p className="meter">
        {usesRemainingCopy(usesRemaining, cap)}
      </p>
      <article className="card">
        <h2>Running total</h2>
        <p>Jev {formatUsd(totals.jevUsd)}</p>
        <p>LLM {formatUsd(totals.llmUsd)}</p>
        <p className="lede">Totals use the price stored with each run.</p>
      </article>
      {sitting ? (
        <button className="card" type="button" onClick={() => onContinue?.()}>
          <h3>Continue sitting</h3>
          <p>{sitting.title}</p>
        </button>
      ) : null}
      <button className="primary" type="button" onClick={onNewJob}>
        New job description
      </button>
      {onModel ? (
        <button className="secondary" type="button" onClick={onModel}>
          ChatGPT and API key
        </button>
      ) : null}
      <div className="stack">
        <h2>Saved roles</h2>
        {roles.map((role) => (
          <button className="card" type="button" key={role.id} onClick={() => onOpenRole?.(role.id)}>
            <h3>{role.title}</h3>
            {role.company ? <p>{role.company}</p> : null}
            {role.summary ? <p>{role.summary}</p> : null}
          </button>
        ))}
        <button className="primary" type="button" disabled={roles.length === 0} onClick={() => onDeleteRoles?.()}>
          Delete all history
        </button>
      </div>
      <div className="stack">
        <h2>Recent evaluations</h2>
        {recent.slice(0, 3).map((row) => {
          const body = (
            <>
              <h3>{evaluatedForCopy(row.roleTitle, row.candidateName)}</h3>
              <p>
                {ACTION_LABEL[row.action as Action] ?? row.action}
                {" · "}
                {row.comparisonEnabled
                  ? `Jev ${formatUsd(row.jevTotalUsd)} · LLM ${formatUsd(row.llmTotalUsd)}`
                  : `Jev ${formatUsd(row.jevTotalUsd)} · LLM off`}
              </p>
            </>
          );
          if (row.status === "success") {
            return (
              <button className="card" type="button" key={row.id} onClick={() => onOpen(row.id)}>
                {body}
              </button>
            );
          }
          return (
            <article className="card" key={row.id}>
              {body}
            </article>
          );
        })}
      </div>
      {error ? <p className="error">{error}</p> : null}
      {onHistory ? (
        <button className="secondary" type="button" onClick={onHistory}>
          History
        </button>
      ) : null}
      <button className="secondary" type="button" onClick={onSignOut}>
        Sign out
      </button>
    </section>
  );
}
