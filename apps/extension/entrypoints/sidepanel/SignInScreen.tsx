import { useState, type FormEvent } from "react";

export function SignInScreen({
  onSubmit,
  error,
}: {
  onSubmit: (email: string, password: string) => Promise<void>;
  error?: string;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    await onSubmit(email, password);
  }

  return (
    <section className="panel">
      <header className="panel-brand">
        <h1>Decision Assistant</h1>
        <p>Local backbone</p>
      </header>
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
          Sign in
        </button>
        {error ? <p className="error">{error}</p> : null}
      </form>
    </section>
  );
}
