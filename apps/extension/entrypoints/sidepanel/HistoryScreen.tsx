import { formatUsd, type Action } from "@decision-assistant/domain";
import { useEffect, useState } from "react";
import { evaluatedForCopy, PRODUCT_NAME } from "../../src/copy";
import { PanelHeader } from "./PanelHeader";

const ACTION_LABEL: Record<Action, string> = {
  contact: "Contact",
  investigate: "Investigate",
  save_for_later: "Save for later",
  skip: "Skip",
};

export type HistoryRow = {
  id: string;
  status?: string;
  action: Action | string;
  roleId?: string;
  roleTitle: string;
  candidateName?: string;
  jevTotalUsd: number;
  llmTotalUsd: number;
  comparisonEnabled: boolean;
};

export function HistoryScreen({
  api,
  onBack,
  onOpen,
}: {
  api: {
    list: () => Promise<{ evaluations: HistoryRow[]; totals: { jevUsd: number; llmUsd: number } }>;
    deleteAll: () => Promise<unknown>;
  };
  onBack?: () => void;
  onOpen?: (id: string) => void;
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
        <PanelHeader title={PRODUCT_NAME} subtitle="History" onBack={onBack} />
      </section>
    );
  }

  return (
    <section className="panel">
      <PanelHeader title={PRODUCT_NAME} subtitle="History" onBack={onBack} />
      <div>
        <h2>Running total</h2>
        <p>Jev {formatUsd(data.totals.jevUsd)}</p>
        <p className="lede">Totals use the price stored with each run.</p>
      </div>
      <div className="stack">
        {data.evaluations.map((row) => {
          const body = (
            <>
              <h3>{evaluatedForCopy(row.roleTitle, row.candidateName)}</h3>
              <p>{ACTION_LABEL[row.action as Action] ?? row.action}</p>
              <p>
                {`Jev ${formatUsd(row.jevTotalUsd)}`}
              </p>
            </>
          );
          if (row.status === "success") {
            return (
              <button className="card" type="button" key={row.id} onClick={() => onOpen?.(row.id)}>
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
      <button className="primary" type="button" onClick={() => void handleDelete()}>
        Delete all history
      </button>
    </section>
  );
}
