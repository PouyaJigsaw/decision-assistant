import { PanelHeader } from "./PanelHeader";

export function EvaluatingScreen({ roleTitle = "Evaluating" }: { roleTitle?: string }) {
  return (
    <section className="panel">
      <PanelHeader title="Decision Assistant" subtitle={roleTitle} />
      <div>
        <h2>Evaluating</h2>
        <p className="lede">
          Jev answers every criterion in one pass. The action is computed locally and is not shown until that call
          succeeds.
        </p>
        <p className="lede">A failed Jev call shows an error and no recommendation.</p>
      </div>
    </section>
  );
}
