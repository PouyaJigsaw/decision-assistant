import { PRODUCT_NAME, usesRemainingCopy } from "../../src/copy";
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
  if (
    body.error === "subscription_sharing_usage_limit_exceeded" ||
    body.error === "subscription_sharing_usage_unavailable"
  ) {
    return "Usage limit reached. Review the plan or app limit in ChatGPT settings.";
  }
  return "Jev did not return a valid decision. No recommendation was saved.";
}

export function ErrorScreen({
  error,
  usesRemaining,
  cap = 3,
  onRetry,
  onManageUsage,
  onBack,
}: {
  error: PanelError;
  usesRemaining?: number | null;
  cap?: number | null;
  onRetry?: () => void;
  onManageUsage?: () => void;
  onBack?: () => void;
}) {
  const usageLimit =
    bodyError(error) === "subscription_sharing_usage_limit_exceeded" ||
    bodyError(error) === "subscription_sharing_usage_unavailable";
  const closed = bodyError(error) === "trial_cap" || bodyError(error) === "daily_spend_cap" || bodyError(error) === "evaluations_disabled";
  const title =
    bodyError(error) === "trial_cap"
      ? "Trial closed"
      : usageLimit
        ? "Usage limit reached"
        : closed
        ? "Evaluate is closed."
        : "Evaluation failed";

  return (
    <section className="panel">
      <PanelHeader title={PRODUCT_NAME} subtitle="Error" onBack={onBack} />
      <div>
        <h2>{title}</h2>
        <p className="lede">{errorMessage(error)}</p>
        {usesRemaining === undefined ? null : (
          <p className="meter">
            {usesRemainingCopy(usesRemaining, cap)}
          </p>
        )}
      </div>
      {usageLimit && onManageUsage ? (
        <button className="primary" type="button" onClick={onManageUsage}>
          Manage usage
        </button>
      ) : onRetry && !closed ? (
        <button className="primary" type="button" onClick={onRetry}>
          Retry
        </button>
      ) : null}
    </section>
  );
}
