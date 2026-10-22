export function PanelHeader({
  title,
  subtitle,
  onBack,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
}) {
  return (
    <header className="panel-brand">
      <img className="brand-mark" src="/icon-128.png" width={28} height={28} alt="" />
      <div className="brand-copy">
        <h1>{title}</h1>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      {onBack ? (
        <button className="brand-back" type="button" aria-label="Back" onClick={onBack}>
          <svg viewBox="0 0 16 16" width={16} height={16} aria-hidden="true">
            <path
              d="M10.25 3.25 4.5 8l5.75 4.75"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Back
        </button>
      ) : null}
    </header>
  );
}
