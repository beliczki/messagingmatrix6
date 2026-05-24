"use client";

import { useId } from "react";
import { useKeywordOptions } from "./useKeywordOptions";

// Free-form text input backed by a Settings → Keywords list for the given
// (form, field). Native <datalist> gives the suggestion dropdown for free.
// Any string commits — empty list ⇒ pure freeform. Used by both DimensionGrid
// (inline cell editor) and HeaderDetailDialog (matrix audience/topic forms)
// so the editors stay in sync.
export function AutocompleteField({
  form,
  field,
  value,
  onChange,
  className,
  placeholder,
}: {
  form: "audiences" | "topics";
  field: string;
  value: string;
  onChange: (next: string) => void;
  className?: string;
  placeholder?: string;
}) {
  const { options } = useKeywordOptions();
  const list = options[form]?.[field] ?? [];
  // useId → stable per-instance datalist id; lets multiple fields with the
  // same (form, field) coexist without clashing.
  const listId = useId();
  return (
    <>
      <input
        type="text"
        list={listId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={className}
        placeholder={placeholder}
      />
      <datalist id={listId}>
        {list.map((opt) => (
          <option key={opt} value={opt} />
        ))}
      </datalist>
    </>
  );
}
