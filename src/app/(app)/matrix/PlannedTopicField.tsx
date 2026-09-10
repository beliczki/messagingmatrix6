"use client";

// The topic a draft is HEADED for, written while it is briefed.
//
// It is a working title, not a key: promotion picks the real topic from the
// topics dimension and never mints one from this. But a working title that
// happens to be well-formed saves that pick, so the DCO side offers the shape
// the dimension actually uses instead of an empty box.
//
// Which shape depends on the production target, and the two are genuinely
// different vocabularies:
//
// - **DCO / Both** — the topics dimension is tagged: product + tag1..tag4, and
//   the client's key pattern joins them with underscores
//   ({{product}}_{{tag1}}_{{tag2}}_{{tag3}}_{{tag4}}). Tags 1–3 are a
//   controlled vocabulary — the values already in use across the dimension, NA
//   included, since "not applicable" is one of them — and tag4 is the specific
//   one, free text, because it names this campaign and nothing else.
// - **Agentic** — those topics are strings synthesized from delivered
//   filenames, with no row in the topics table to take a vocabulary from. One
//   free field is the honest control.
//
// The authoritative generator is `keyFromPattern` in entities/topics.ts, which
// evaluates the stored pattern. This composes (and splits) on "_" to match it;
// the two would drift only if a client changed the pattern's separator, and
// what drifts is a suggestion in a text field, not a key anything resolves by.
import { useEffect, useMemo, useRef, useState } from "react";
import Field from "./EditorField";
import type { TopicRow } from "./BriefTab";

export type Parts = { tag1: string; tag2: string; tag3: string; tag4: string };

export function splitTopic(value: string | null, product: string | null): Parts {
  const empty = { tag1: "", tag2: "", tag3: "", tag4: "" };
  if (!value) return empty;
  let rest = value;
  // The product prefix belongs to the key, not to the tags — drop it so the
  // pickers show what the user actually chose.
  if (product && rest.toUpperCase().startsWith(`${product.toUpperCase()}_`)) {
    rest = rest.slice(product.length + 1);
  }
  const parts = rest.split("_");
  return {
    tag1: parts[0] ?? "",
    tag2: parts[1] ?? "",
    tag3: parts[2] ?? "",
    // Everything left, joined back: tag4 is free text and may carry underscores
    // of its own.
    tag4: parts.slice(3).join("_"),
  };
}

// POSITION-PRESERVING, and that is not a detail: dropping the empty parts made
// "tag4 = t" compose to `MARKET_t`, which reads back as tag1 = "t" — the
// character typed into the last field reappeared in the first one, and the
// caret went with it. Empty slots stay as empty segments (`MARKET____t`), which
// is also exactly what the stored key pattern produces for the same input.
// Trailing empties are dropped, since nothing follows them to hold a position.
export function joinTopic(product: string | null, p: Parts): string {
  const parts = [product ?? "", p.tag1, p.tag2, p.tag3, p.tag4].map((s) =>
    (s ?? "").trim(),
  );
  while (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
  return parts.join("_");
}

/** The values a tag column already carries across the dimension. */
function vocabulary(
  topics: TopicRow[],
  pick: (t: TopicRow) => string | null,
): string[] {
  const seen = new Set<string>();
  for (const t of topics) {
    const v = (pick(t) ?? "").trim();
    if (v) seen.add(v);
  }
  return [...seen].sort((a, b) => {
    // NA first: it is the "this axis does not apply" answer, and it is the most
    // frequently correct one on tags 2 and 3.
    if (a === "NA") return -1;
    if (b === "NA") return 1;
    return a.localeCompare(b);
  });
}

export default function PlannedTopicField({
  target,
  product,
  topics,
  value,
  onChange,
}: {
  /** `draftTarget`; null means undecided, and DCO is the assumed shape. */
  target: string | null;
  product: string | null;
  topics: TopicRow[];
  value: string | null;
  onChange: (topic: string | null) => void;
}) {
  const tagged = target !== "agentic";

  // The four parts are LOCAL state, not a re-parse of `value` on every render.
  // Deriving them meant every keystroke went out as a composed string and came
  // back through the splitter, so the input's value was whatever survived that
  // round-trip — the caret jumped on every character. `composedRef` remembers
  // what we last wrote, so a `value` that differs from it is a genuine outside
  // change (another variant opened, a reload) and re-seeds the fields.
  const [parts, setParts] = useState<Parts>(() => splitTopic(value, product));
  const composedRef = useRef<string>(value ?? "");
  useEffect(() => {
    if ((value ?? "") !== composedRef.current) {
      setParts(splitTopic(value, product));
      composedRef.current = value ?? "";
    }
  }, [value, product]);
  const vocab = useMemo(
    () => ({
      tag1: vocabulary(topics, (t) => t.tag1),
      tag2: vocabulary(topics, (t) => t.tag2),
      tag3: vocabulary(topics, (t) => t.tag3),
    }),
    [topics],
  );

  if (!tagged) {
    return (
      <Field label="Planned topic">
        <input
          type="text"
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value || null)}
          placeholder="working title — the real topic is picked at promote"
          className="input-box w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs focus:border-slate-500 focus:outline-none"
        />
      </Field>
    );
  }

  function set(patch: Partial<Parts>) {
    const next = { ...parts, ...patch };
    setParts(next);
    const composed = joinTopic(product, next);
    composedRef.current = composed;
    onChange(composed || null);
  }

  return (
    <Field label="Planned topic">
      <div className="planned-topic flex flex-col gap-1">
        {/* The four parts on ONE row, in key order — they read as the key they
            compose, and stacked they read as four unrelated questions.
            `min-w-0` on each: without it a long option value sets the select's
            intrinsic width and the row overflows instead of sharing. */}
        <div className="planned-topic__row flex items-center gap-1.5">
        {(["tag1", "tag2", "tag3"] as const).map((tag, i) => (
          <select
            key={tag}
            value={parts[tag]}
            onChange={(e) => set({ [tag]: e.target.value } as Partial<Parts>)}
            title={`Tag ${i + 1}`}
            className="input-box custom-dropdown planned-topic__tag min-w-0 flex-1 rounded-md border border-slate-300 px-1.5 py-1.5 text-xs focus:border-slate-500 focus:outline-none"
          >
            <option value="">— tag {i + 1} —</option>
            {/* A value the draft already carries but the dimension does not —
                a topic that was archived, say — must not vanish from its own
                picker. */}
            {(vocab[tag].includes(parts[tag]) || !parts[tag]
              ? vocab[tag]
              : [parts[tag], ...vocab[tag]]
            ).map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        ))}
        <input
          type="text"
          value={parts.tag4}
          onChange={(e) => set({ tag4: e.target.value })}
          placeholder="tag 4"
          title="Tag 4 — the campaign's own word"
          className="input-box planned-topic__tag4 min-w-0 flex-1 rounded-md border border-slate-300 px-1.5 py-1.5 text-xs focus:border-slate-500 focus:outline-none"
        />
        </div>
        {/* What the four parts add up to, so the field shows the key it is
            proposing rather than making the user assemble it in their head. */}
        <p className="planned-topic__preview truncate text-[10px] text-slate-400">
          {joinTopic(product, parts) || "— nothing picked yet —"}
        </p>
      </div>
    </Field>
  );
}
