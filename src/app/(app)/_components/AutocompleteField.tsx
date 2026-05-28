"use client";

import { useId, useState } from "react";
import { useKeywordOptions } from "./useKeywordOptions";

// Free-form text input backed by a Settings → Keywords list for the given
// (form, field). Native <datalist> gives the suggestion dropdown for free.
// Any string commits — empty list ⇒ pure freeform. Used by both DimensionGrid
// (inline cell editor) and HeaderDetailDialog (matrix audience/topic forms)
// so the editors stay in sync.
//
// On focus the input is shown empty (current value moves to the placeholder)
// so the native datalist shows the full options list — Chrome filters
// suggestions by the input's current value, so pre-filling collapses the
// dropdown to just the current match. Blur without typing leaves the parent
// value untouched.
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
  const [focused, setFocused] = useState(false);
  const [dirty, setDirty] = useState(false);
  const displayValue = focused && !dirty ? "" : value;
  const displayPlaceholder =
    focused && !dirty && value ? value : placeholder;
  return (
    <>
      <input
        type="text"
        list={listId}
        value={displayValue}
        onChange={(e) => {
          setDirty(true);
          onChange(e.target.value);
        }}
        onFocus={() => {
          setFocused(true);
          setDirty(false);
        }}
        onBlur={() => {
          setFocused(false);
          setDirty(false);
        }}
        className={className}
        placeholder={displayPlaceholder}
      />
      <datalist id={listId}>
        {list.map((opt) => (
          <option key={opt} value={opt} />
        ))}
      </datalist>
    </>
  );
}
