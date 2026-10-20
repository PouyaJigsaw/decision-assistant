import { useEffect, useState } from "react";
import { PRODUCT_NAME } from "../../src/copy";
import { PanelHeader } from "./PanelHeader";

const EVALUATE_STEPS = [
  "Sending the approved profile…",
  "Jev is scoring every criterion…",
  "Building the recommendation…",
];

const DRAFT_STEPS = [
  "Sending the job description…",
  "The connected model is drafting criteria…",
  "Building the rubric…",
];

export function EvaluatingScreen({
  roleTitle = "Evaluating",
  onBack,
  mode = "evaluate",
}: {
  roleTitle?: string;
  onBack?: () => void;
  mode?: "evaluate" | "draft";
}) {
  const [step, setStep] = useState(0);
  const draft = mode === "draft";
  const steps = draft ? DRAFT_STEPS : EVALUATE_STEPS;

  useEffect(() => {
    const timer = window.setInterval(() => {
      setStep((current) => (current + 1) % steps.length);
    }, 2500);
    return () => window.clearInterval(timer);
  }, [steps.length]);

  return (
    <section className="panel" aria-busy="true">
      <PanelHeader title={PRODUCT_NAME} subtitle={roleTitle} onBack={draft ? undefined : onBack} />
      <div className="evaluating">
        <div className="spinner" role="progressbar" aria-label={draft ? "Drafting" : "Evaluating"} />
        <h2>{draft ? "Drafting this rubric" : "Evaluating this profile"}</h2>
        <p className="lede" role="status">
          {steps[step]}
        </p>
        <p className="lede">This can take up to a minute.</p>
        <p className="lede">{draft ? "Jev does not write the rubric." : "Nothing is messaged to the candidate."}</p>
      </div>
    </section>
  );
}
