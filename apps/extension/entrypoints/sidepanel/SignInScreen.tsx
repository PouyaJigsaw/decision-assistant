import { useState, type FormEvent } from "react";
import { PRODUCT_NAME } from "../../src/copy";
import { PanelHeader } from "./PanelHeader";

export function SignInScreen({
  onSubmit,
  onSignup,
  error,
}: {
  onSubmit: (email: string, password: string) => Promise<void>;
  onSignup: (email: string, password: string) => Promise<void>;
  error?: string;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"signin" | "signup">("signin");

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (mode === "signup") {
      await onSignup(email, password);
      return;
    }
    await onSubmit(email, password);
  }

  return (
    <section className="panel">
      <PanelHeader title={PRODUCT_NAME} />
      <form className="stack" onSubmit={handleSubmit}>
        <label className="stack">
          <span className="field-label">Email</span>
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>
        <label className="stack">
          <span className="field-label">Password</span>
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        <button className="primary" type="submit">
          {mode === "signup" ? "Create account" : "Sign in"}
        </button>
        <button
          className="secondary"
          type="button"
          onClick={() => setMode(mode === "signup" ? "signin" : "signup")}
        >
          {mode === "signup" ? "Sign in" : "Sign up"}
        </button>
        {error ? <p className="error">{error}</p> : null}
      </form>
    </section>
  );
}
