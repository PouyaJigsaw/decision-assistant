import { PanelHeader } from "./PanelHeader";

export type PanelError = { status: number; body: unknown };

function bodyError(error: PanelError) {
  return error.body && typeof error.body === "object"
    ? (error.body as Record<string, unknown>).error
    : undefined;
}

function errorMessage(error: PanelError) {
  const body = error.body && typeof error.body === "object" ? (error.body as Record<string, unknown>) : {};
  if (body.error === "trial_cap") {
    return typeof body.message === "string"
      ? body.message
      : "This trial covered three profiles. Evaluate is closed.";
  }
  if (body.error === "daily_spend_cap") {
    return "Today's spend limit is reached. Evaluate is closed.";
  }
  if (body.error === "evaluations_disabled") {
    return "Evaluate is turned off. No provider call was made.";
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
  const closed = bodyError(error) === "trial_cap" || bodyError(error) === "daily_spend_cap" || bodyError(error) === "evaluations_disabled";
  const title =
    bodyError(error) === "trial_cap"
      ? "Trial closed"
      : closed
        ? "Evaluate is closed."
        : "Evaluation failed";

  return (
    <section className="panel">
      <PanelHeader title="Decision Assistant" subtitle="Error" />
      <div>
        <h2>{title}</h2>
        <p className="lede">{errorMessage(error)}</p>
        {usesRemaining != null ? <p className="meter">Uses remaining: {usesRemaining} of 3</p> : null}
      </div>
      {onRetry && !closed ? (
        <button className="primary" type="button" onClick={onRetry}>
          Retry
        </button>
      ) : null}
    </section>
  );
}
