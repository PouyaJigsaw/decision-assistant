import { useState } from "react";
import { approvedText } from "../../src/payload";
import { PanelHeader } from "./PanelHeader";

export type ExtractSection = { id: string; title: string; text: string };

export function PreviewScreen({
  url,
  roleTitle,
  sections,
  api,
  onEvaluated,
}: {
  url: string;
  roleTitle: string;
  sections: ExtractSection[];
  api: {
    evaluate: (body: {
      approvedText: string;
      comparisonEnabled: boolean;
      keepExtracts: boolean;
    }) => Promise<unknown>;
  };
  onEvaluated: () => void;
}) {
  const [removed, setRemoved] = useState<Record<string, boolean>>({});
  const [comparisonEnabled, setComparisonEnabled] = useState(true);
  const [keepExtracts, setKeepExtracts] = useState(false);
  const [busy, setBusy] = useState(false);

  const preview = sections.map((section) => ({
    ...section,
    removed: Boolean(removed[section.id]),
  }));

  async function handleEvaluate() {
    setBusy(true);
    try {
      await api.evaluate({
        approvedText: approvedText(preview),
        comparisonEnabled,
        keepExtracts,
      });
      onEvaluated();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <PanelHeader title="Decision Assistant" subtitle={roleTitle} />
      <div>
        <h2>Preview the extract</h2>
        <p className="lede">Nothing is uploaded until you confirm.</p>
        <p className="lede">
          Confirming Evaluate sends the approved text to the server, then to Jev and the language model. Nothing is
          messaged to the candidate.
        </p>
        <p className="url">{url}</p>
      </div>
      <div className="stack">
        {preview
          .filter((section) => !section.removed)
          .map((section) => (
            <article className="card" key={section.id}>
              <div className="card-head">
                <h3>{section.title}</h3>
                <button type="button" aria-label={`Remove ${section.title}`} onClick={() => setRemoved((c) => ({ ...c, [section.id]: true }))}>
                  Remove
                </button>
              </div>
              <p>{section.text}</p>
            </article>
          ))}
      </div>
      <label className="check">
        <input
          type="checkbox"
          checked={comparisonEnabled}
          onChange={(event) => setComparisonEnabled(event.target.checked)}
        />
        Also run direct LLM
      </label>
      <p className="lede">Same questions, so the token comparison is fair.</p>
      <label className="check">
        <input type="checkbox" checked={keepExtracts} onChange={(event) => setKeepExtracts(event.target.checked)} />
        Keep extracts on the server
      </label>
      <button className="primary" type="button" disabled={busy} onClick={() => void handleEvaluate()}>
        Evaluate
      </button>
    </section>
  );
}
