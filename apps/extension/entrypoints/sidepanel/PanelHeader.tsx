export function PanelHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <header className="panel-brand">
      <h1>{title}</h1>
      <p>{subtitle}</p>
    </header>
  );
}
