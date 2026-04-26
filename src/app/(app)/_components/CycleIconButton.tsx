"use client";

import clsx from "clsx";

export type CycleOption<T extends string | number> = {
  value: T;
  icon: React.ReactNode;
  label: string;
};

type Props<T extends string | number> = {
  options: CycleOption<T>[];
  value: T;
  onChange: (next: T) => void;
  className?: string;
  /** Tailwind size class, e.g. "size-9". Defaults to "size-9". */
  size?: string;
};

/**
 * Square icon button that cycles through a fixed set of options on each click,
 * wrapping back to the first after the last. Renders the icon for the current
 * value; tooltip shows current → next label so users can predict the next click.
 */
export default function CycleIconButton<T extends string | number>({
  options,
  value,
  onChange,
  className,
  size = "size-9",
}: Props<T>) {
  if (options.length === 0) return null;
  const idx = options.findIndex((o) => o.value === value);
  const i = idx >= 0 ? idx : 0;
  const cur = options[i];
  const nextOpt = options[(i + 1) % options.length];

  return (
    <button
      type="button"
      onClick={() => onChange(nextOpt.value)}
      title={`${cur.label} → ${nextOpt.label}`}
      aria-label={cur.label}
      className={clsx(
        "flex items-center justify-center rounded-md text-slate-700 transition hover:bg-slate-100",
        size,
        className,
      )}
    >
      {cur.icon}
    </button>
  );
}
