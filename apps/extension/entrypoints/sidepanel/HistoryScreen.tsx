import { formatUsd, type Action } from "@decision-assistant/domain";
import { useEffect, useState } from "react";
import { PanelHeader } from "./PanelHeader";

const ACTION_LABEL: Record<Action, string> = {
  contact: "Contact",
  investigate: "Investigate",
  save_for_later: "Save for later",
  skip: "Skip",
};

export type HistoryRow = {
  id: string;
  action: Action | string;
  roleTitle: string;
  jevTotalUsd: number;
  llmTotalUsd: number;
  comparisonEnabled: boolean;
};

export function HistoryScreen({
  usesRemaining,
  api,
}: {
  usesRemaining: number;
  api: {
    list: () => Promise<{ evaluations: HistoryRow[]; totals: { jevUsd: number; llmUsd: number } }>;
    deleteAll: () => Promise<unknown>;
  };
}) {
  const [data, setData] = useState<{ evaluations: HistoryRow[]; totals: { jevUsd: number; llmUsd: number } } | null>(
    null,
  );

  useEffect(() => {
    void api.list().then(setData);
  }, [api]);

  async function handleDelete() {
    await api.deleteAll();
    setData(await api.list());
  }

  if (!data) {
    return (
      <section className="panel">
        <PanelHeader title="Decision Assistant" subtitle="History" />
      </section>
    );
  }

  return (
    <section className="panel">
      <PanelHeader title="Decision Assistant" subtitle="History" />
      <div>
        <h2>Running total</h2>
        <p>Jev {formatUsd(data.totals.jevUsd)}</p>
        <p>LLM {formatUsd(data.totals.llmUsd)}</p>
        <p className="lede">Totals use the price stored with each run.</p>
        <p className="meter">Uses remaining: {usesRemaining} of 3</p>
      </div>
      <div className="stack">
        {data.evaluations.map((row) => (
          <article className="card" key={row.id}>
            <h3>{ACTION_LABEL[row.action as Action] ?? row.action}</h3>
            <p>{row.roleTitle}</p>
            <p>
              {row.comparisonEnabled
                ? `Jev ${formatUsd(row.jevTotalUsd)} · LLM ${formatUsd(row.llmTotalUsd)}`
                : `Jev ${formatUsd(row.jevTotalUsd)} · LLM off`}
            </p>
          </article>
        ))}
      </div>
      <button className="primary" type="button" onClick={() => void handleDelete()}>
        Delete all history
      </button>
    </section>
  );
}
