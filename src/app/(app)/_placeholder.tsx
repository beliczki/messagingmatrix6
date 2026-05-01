// Shared placeholder for nav routes whose UI will land in later phases.
export function Placeholder({
  title,
  phase,
  description,
}: {
  title: string;
  phase: string;
  description: string;
}) {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="empty-state placeholder-card max-w-md rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
        <p className="placeholder-card__phase text-xs uppercase tracking-wide text-slate-500">{phase}</p>
        <h1 className="empty-state__title mt-1 text-xl font-semibold text-slate-900">{title}</h1>
        <p className="empty-state__hint mt-3 text-sm text-slate-600">{description}</p>
      </div>
    </div>
  );
}
