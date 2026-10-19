import { useEffect, useState } from "react";
import { PRODUCT_NAME } from "../../src/copy";
import { approvedText } from "../../src/payload";
import { PanelHeader } from "./PanelHeader";

export type ExtractSection = { id: string; title: string; text: string };

export function PreviewScreen({
  url,
  roleTitle,
  sections,
  api,
  onEvaluated,
  onRecapture,
  onChangeJob,
  captureError,
  billing,
  onBack,
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
  onRecapture?: () => void;
  onChangeJob?: () => void;
  captureError?: string;
  billing?: string;
  onBack?: () => void;
}) {
  const [removed, setRemoved] = useState<Record<string, boolean>>({});
  const [comparisonEnabled, setComparisonEnabled] = useState(true);
  const [keepExtracts, setKeepExtracts] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setRemoved({});
  }, [url, sections]);

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
      <PanelHeader title={PRODUCT_NAME} subtitle={roleTitle} onBack={onBack} />
      <div>
        <h2>Preview the extract</h2>
        <p className="lede">Nothing is uploaded until you confirm.</p>
        <p className="lede">
          Confirming Evaluate sends the approved text to the server, then to Jev and the language model. Nothing is
          messaged to the candidate.
        </p>
        <p className="url">{url}</p>
        {onRecapture || onChangeJob ? (
          <div className="stack">
            {onRecapture ? (
              <>
                <p className="lede">Focus the page you want, then read that tab.</p>
                <button className="secondary" type="button" onClick={onRecapture}>
                  Read this tab
                </button>
              </>
            ) : null}
            {onChangeJob ? (
              <button className="secondary" type="button" onClick={onChangeJob}>
                Change job description
              </button>
            ) : null}
            {captureError ? <p className="error">{captureError}</p> : null}
          </div>
        ) : null}
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
      {billing ? <p className="lede">{billing}</p> : null}
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
