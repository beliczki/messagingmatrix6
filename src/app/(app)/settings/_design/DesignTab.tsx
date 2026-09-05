"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DEFAULT_LOOK_AND_FEEL } from "@/db/defaults";
import { MC_STATUSES, statusSlug, type McStatus } from "@/lib/mc-status";
import { SettingsHeaderActions } from "../SettingsView";

type LookAndFeel = typeof DEFAULT_LOOK_AND_FEEL;

// Every status gets a colour, DRAFT included — it shows on the drafts page.
const STATUS_KEYS = MC_STATUSES;
type StatusKey = McStatus;

const STATUS_VAR: Record<StatusKey, string> = Object.fromEntries(
  MC_STATUSES.map((s) => [s, `--status-${statusSlug(s)}`]),
) as Record<StatusKey, string>;

function mergeLookAndFeel(raw: unknown): LookAndFeel {
  const v = (raw ?? {}) as Partial<LookAndFeel>;
  return {
    ...DEFAULT_LOOK_AND_FEEL,
    ...v,
    statusColors: {
      ...DEFAULT_LOOK_AND_FEEL.statusColors,
      ...(v.statusColors ?? {}),
    },
    cobranding: {
      ...DEFAULT_LOOK_AND_FEEL.cobranding,
      ...(v.cobranding ?? {}),
    },
  };
}

function applyLive(laf: LookAndFeel) {
  const root = document.documentElement;
  root.style.setProperty("--brand-primary", laf.headerColor);
  root.style.setProperty("--brand-button", laf.buttonColor);
  root.style.setProperty("--brand-secondary-1", laf.secondaryColor1);
  root.style.setProperty("--brand-secondary-2", laf.secondaryColor2);
  root.style.setProperty("--brand-secondary-3", laf.secondaryColor3);
  root.style.setProperty("--brand-secondary-4", laf.secondaryColor4);
  root.style.setProperty(
    "--font-base",
    `"${laf.fontFamily}", system-ui, sans-serif`,
  );
  for (const k of STATUS_KEYS) {
    root.style.setProperty(STATUS_VAR[k], laf.statusColors[k]);
  }
  // Colour mode (light/dark) is no longer managed here — it is a per-browser
  // toggle in the sidebar (localStorage mm6_theme + the `.dark` class). Applying
  // it here would clobber that choice whenever brand colours are saved.
}

export function DesignTab() {
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: ["config", "lookAndFeel"],
    queryFn: async (): Promise<LookAndFeel> => {
      const r = await fetch("/api/config?key=lookAndFeel");
      if (!r.ok) throw new Error("config fetch failed");
      const data = (await r.json()) as { rows: Array<{ value: unknown }> };
      return mergeLookAndFeel(data.rows[0]?.value);
    },
  });

  const [draft, setDraft] = useState<LookAndFeel | null>(null);
  useEffect(() => {
    if (q.data && !draft) setDraft(q.data);
  }, [q.data, draft]);

  const m = useMutation({
    mutationFn: async (laf: LookAndFeel) => {
      const r = await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: "lookAndFeel",
          category: "lookAndFeel",
          value: laf,
        }),
      });
      if (!r.ok) throw new Error("save failed");
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["config", "lookAndFeel"] });
    },
  });

  function setField<K extends keyof LookAndFeel>(k: K, v: LookAndFeel[K]) {
    if (!draft) return;
    const next = { ...draft, [k]: v };
    setDraft(next);
    applyLive(next);
  }

  function setStatus(k: StatusKey, v: string) {
    if (!draft) return;
    const next = {
      ...draft,
      statusColors: { ...draft.statusColors, [k]: v },
    };
    setDraft(next);
    applyLive(next);
  }

  function revert() {
    if (!q.data) return;
    setDraft(q.data);
    applyLive(q.data);
  }

  if (!draft) {
    return <p className="text-sm text-slate-500">Loading…</p>;
  }

  return (
    <div className="design-tab max-w-3xl">
      <SettingsHeaderActions>
        {m.isError ? (
          <span className="text-sm text-rose-600">Save failed</span>
        ) : null}
        {m.isSuccess && !m.isPending ? (
          <span className="text-sm text-emerald-600">Saved</span>
        ) : null}
        <button
          type="button"
          onClick={revert}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Revert
        </button>
        <button
          type="button"
          onClick={() => m.mutate(draft)}
          disabled={m.isPending}
          className="toolbar-btn--primary rounded-md bg-brand-button px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {m.isPending ? "Saving…" : "Save"}
        </button>
      </SettingsHeaderActions>
      <header className="design-tab__header mb-6">
        <p className="text-sm text-slate-500">
          Brand and status colors flow into CSS variables on{" "}
          <code className="rounded bg-slate-100 px-1 font-mono text-xs">
            &lt;html&gt;
          </code>
          . Edits apply live below; click Save to persist for everyone.
        </p>
      </header>

      <Section title="Branding">
        <ColorField
          label="Header / brand primary"
          value={draft.headerColor}
          onChange={(v) => setField("headerColor", v)}
        />
        <ColorField
          label="Primary button"
          value={draft.buttonColor}
          onChange={(v) => setField("buttonColor", v)}
        />
        <ColorField
          label="Secondary 1"
          value={draft.secondaryColor1}
          onChange={(v) => setField("secondaryColor1", v)}
        />
        <ColorField
          label="Secondary 2"
          value={draft.secondaryColor2}
          onChange={(v) => setField("secondaryColor2", v)}
        />
        <ColorField
          label="Secondary 3"
          value={draft.secondaryColor3}
          onChange={(v) => setField("secondaryColor3", v)}
        />
        <ColorField
          label="Secondary 4"
          value={draft.secondaryColor4}
          onChange={(v) => setField("secondaryColor4", v)}
        />
      </Section>

      <Section title="Identity">
        <TextField
          label="Page title"
          value={draft.pageTitle}
          onChange={(v) => setField("pageTitle", v)}
        />
        <TextField
          label="Font family"
          value={draft.fontFamily}
          onChange={(v) => setField("fontFamily", v)}
        />
        <CheckboxField
          label="Capsule (rounded) UI"
          checked={draft.capsuleDesign}
          onChange={(v) => setField("capsuleDesign", v)}
        />
      </Section>

      <Section title="Cobranding">
        <CheckboxField
          label="Enable cobranding logo"
          checked={draft.cobranding.enabled}
          onChange={(v) =>
            setField("cobranding", { ...draft.cobranding, enabled: v })
          }
        />
        <TextField
          label="Logo URL"
          value={draft.cobranding.logoUrl}
          onChange={(v) =>
            setField("cobranding", { ...draft.cobranding, logoUrl: v })
          }
        />
      </Section>

      <Section title="Status colors">
        {STATUS_KEYS.map((k) => (
          <ColorField
            key={k}
            label={k}
            value={draft.statusColors[k]}
            onChange={(v) => setStatus(k, v)}
          />
        ))}
      </Section>

    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="design-tab__section mb-6 rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="design-tab__section-title mb-3 text-sm font-semibold uppercase tracking-wide text-slate-700">
        {title}
      </h3>
      <div className="design-tab__fields grid grid-cols-1 gap-3 md:grid-cols-2">
        {children}
      </div>
    </section>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="form-field flex items-center gap-3">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="form-field__color size-9 shrink-0 cursor-pointer rounded border border-slate-300 bg-white"
      />
      <div className="form-field__body min-w-0 flex-1">
        <p className="form-field__label truncate text-sm font-medium text-slate-700">
          {label}
        </p>
        <p className="form-field__hint mt-0.5 font-mono text-xs text-slate-500">
          {value}
        </p>
      </div>
    </label>
  );
}

function TextField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="form-field block">
      <span className="form-field__label mb-1 block text-sm font-medium text-slate-700">
        {label}
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="input-box w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-slate-500 focus:outline-none"
      />
    </label>
  );
}

function CheckboxField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="form-field flex items-center gap-2">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="form-field__checkbox size-4"
      />
      <span className="form-field__label text-sm font-medium text-slate-700">
        {label}
      </span>
    </label>
  );
}
