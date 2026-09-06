// The labelled field wrapper every editor tab uses. Extracted from
// MessageEditor when the Brief tab moved into its own file: two copies of this
// markup would be two places for the label typography to drift, and the tabs
// sit side by side where any drift is immediately visible.
import React from "react";

export default function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="form-field mb-3 block">
      <div className="form-field__label mb-1 text-xs font-medium text-slate-700">{label}</div>
      {children}
      {hint ? <div className="form-field__hint mt-1 text-[10px] text-slate-400">{hint}</div> : null}
    </label>
  );
}
