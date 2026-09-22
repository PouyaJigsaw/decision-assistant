import { PanelHeader } from "./PanelHeader";

export type PanelError = { status: number; body: unknown };

function errorMessage(error: PanelError) {
  const body = error.body && typeof error.body === "object" ? (error.body as Record<string, unknown>) : {};
  if (error.status === 409 || body.error === "trial_cap") {
    return typeof body.message === "string"
      ? body.message
      : "This trial covered three profiles. Evaluate is closed.";
  }
  return "Jev did not return a valid decision. No recommendation was saved, and the comparison was not shown.";
}

export function ErrorScreen({
  error,
  usesRemaining,
  onRetry,
}: {
  error: PanelError;
  usesRemaining?: number;
  onRetry?: () => void;
}) {
  const trialCap = error.status === 409 || (typeof error.body === "object" && error.body && "error" in error.body && error.body.error === "trial_cap");

  return (
    <section className="panel">
      <PanelHeader title="Decision Assistant" subtitle="Error" />
      <div>
        <h2>{trialCap ? "Trial closed" : "Evaluation failed"}</h2>
        <p className="lede">{errorMessage(error)}</p>
        {usesRemaining != null ? <p className="meter">Uses remaining: {usesRemaining} of 3</p> : null}
      </div>
      {onRetry && !trialCap ? (
        <button className="primary" type="button" onClick={onRetry}>
          Retry
        </button>
      ) : null}
    </section>
  );
}
