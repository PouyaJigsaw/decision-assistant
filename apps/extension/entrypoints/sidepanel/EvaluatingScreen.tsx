import { useEffect, useState } from "react";
import { PRODUCT_NAME } from "../../src/copy";
import { PanelHeader } from "./PanelHeader";

const STEPS = [
  "Sending the approved profile…",
  "Jev is scoring every criterion…",
  "Building the recommendation…",
];

export function EvaluatingScreen({ roleTitle = "Evaluating", onBack }: { roleTitle?: string; onBack?: () => void }) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setStep((current) => (current + 1) % STEPS.length);
    }, 2500);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <section className="panel" aria-busy="true">
      <PanelHeader title={PRODUCT_NAME} subtitle={roleTitle} onBack={onBack} />
      <div className="evaluating">
        <div className="spinner" role="progressbar" aria-label="Evaluating" />
        <h2>Evaluating this profile</h2>
        <p className="lede" role="status">
          {STEPS[step]}
        </p>
        <p className="lede">This can take up to a minute.</p>
        <p className="lede">Nothing is messaged to the candidate.</p>
      </div>
    </section>
  );
}
