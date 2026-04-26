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
      <div className="max-w-md rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
        <p className="text-xs uppercase tracking-wide text-slate-500">{phase}</p>
        <h1 className="mt-1 text-xl font-semibold text-slate-900">{title}</h1>
        <p className="mt-3 text-sm text-slate-600">{description}</p>
      </div>
    </div>
  );
}
