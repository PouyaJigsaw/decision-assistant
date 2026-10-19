import { useState, type FormEvent } from "react";
import { PRODUCT_NAME } from "../../src/copy";
import type { Connection } from "../../src/llm-credentials";
import type { ListedModel } from "../../src/openai-responses";
import { PanelHeader } from "./PanelHeader";

export function billingCopy(connection: Connection): string {
  if (connection.kind === "api_key") return "Using your API key for this browser session";
  if (connection.kind === "chatgpt" && connection.planUsage) return "Using ChatGPT plan";
  if (connection.kind === "chatgpt") return "ChatGPT is signed in. Enable plan usage to run the model.";
  return "Connect ChatGPT or an API key to draft and compare.";
}

export function ConnectionScreen({
  connection,
  models,
  selectedModel,
  showWelcome,
  error,
  onConnectChatGpt,
  onDisconnect,
  onSaveKey,
  onClearKey,
  onSelectModel,
  onManageUsage,
  onDismissWelcome,
  onBack,
}: {
  connection: Connection;
  models: ListedModel[];
  selectedModel: string;
  showWelcome: boolean;
  error?: string;
  onConnectChatGpt: () => Promise<void>;
  onDisconnect: () => Promise<void>;
  onSaveKey: (key: string) => Promise<void>;
  onClearKey: () => Promise<void>;
  onSelectModel: (slug: string) => void;
  onManageUsage: () => void;
  onDismissWelcome: () => void;
  onBack?: () => void;
}) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);

  async function saveKey(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await onSaveKey(key);
      setKey("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <PanelHeader title={PRODUCT_NAME} subtitle="Model" onBack={onBack} />
      {showWelcome ? (
        <article className="card">
          <h2>You’re using your ChatGPT plan</h2>
          <p className="lede">Eligible draft and comparison requests use your ChatGPT plan. Manage usage in ChatGPT settings.</p>
          <button className="primary" type="button" onClick={onDismissWelcome}>
            Got it
          </button>
        </article>
      ) : null}
      <p className="lede">{billingCopy(connection)}</p>
      {connection.kind === "none" || (connection.kind === "chatgpt" && !connection.planUsage) ? (
        <div className="stack">
          <button
            className="primary"
            type="button"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void onConnectChatGpt().finally(() => setBusy(false));
            }}
          >
            Continue with ChatGPT
          </button>
          {connection.kind === "chatgpt" ? (
            <p className="lede">Plan usage is off for this app. Enable it, or use an API key for this browser session.</p>
          ) : null}
        </div>
      ) : null}
      {connection.kind === "chatgpt" && connection.planUsage ? (
        <article className="card">
          <h2>{connection.email}</h2>
          <p className="lede">Using ChatGPT plan</p>
          {models.length ? (
            <label className="stack">
              <span className="field-label">Model</span>
              <select value={selectedModel} onChange={(event) => onSelectModel(event.target.value)}>
                {models.map((model) => (
                  <option key={model.slug} value={model.slug}>
                    {model.display_name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <button className="secondary" type="button" onClick={onManageUsage}>
            Manage usage
          </button>
          <button className="secondary" type="button" onClick={() => void onDisconnect()}>
            Disconnect
          </button>
        </article>
      ) : null}
      {connection.kind === "api_key" ? (
        <article className="card">
          <h2>API key</h2>
          <p className="lede">Using your API key for this browser session. It is forgotten when the browser closes.</p>
          <button className="secondary" type="button" onClick={() => void onClearKey()}>
            Clear key
          </button>
        </article>
      ) : connection.kind === "chatgpt" && connection.planUsage ? null : (
        <form className="stack" onSubmit={saveKey}>
          <label className="stack">
            <span className="field-label">OpenAI API key</span>
            <input
              type="password"
              autoComplete="off"
              value={key}
              onChange={(event) => setKey(event.target.value)}
            />
          </label>
          <button className="secondary" type="submit" disabled={busy || !key.trim()}>
            Use an API key
          </button>
          <p className="lede">The key stays in this browser session only. It is not saved on the server.</p>
        </form>
      )}
      {error ? <p className="error">{error}</p> : null}
    </section>
  );
}
