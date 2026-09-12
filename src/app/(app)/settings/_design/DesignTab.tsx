"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DEFAULT_LOOK_AND_FEEL } from "@/db/defaults";
import { MC_STATUSES, statusSlug, type McStatus } from "@/lib/mc-status";
import { FONT_OPTIONS, fontStack } from "@/lib/fonts";
import { Icon, IconSetProvider, type IconName } from "@/app/_icons/Icon";
import { ICON_SETS, asIconSet, type IconSet } from "@/app/_icons/types";
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
  root.style.setProperty("--font-base", fontStack(laf.fontFamily));
  for (const k of STATUS_KEYS) {
    root.style.setProperty(STATUS_VAR[k], laf.statusColors[k]);
  }
  // Colour mode (light/dark) is no longer managed here — it is a per-browser
  // toggle in the sidebar (localStorage mm6_theme + the `.dark` class). Applying
  // it here would clobber that choice whenever brand colours are saved.
}

export function DesignTab() {
  const qc = useQueryClient();
  const router = useRouter();

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
      // The icon family and the cobranding logo are resolved server-side in
      // the app shell, so an invalidated client query alone would leave the
      // rest of the screen on the previous choice until a hard reload.
      router.refresh();
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

  // A face typed into the old free-text field stays selectable instead of
  // vanishing from its own dropdown — the same rule the filter pills follow
  // for a selected value that left the option list.
  const fontOptions = FONT_OPTIONS.some((f) => f.value === draft.fontFamily)
    ? FONT_OPTIONS
    : [
        ...FONT_OPTIONS,
        { value: draft.fontFamily, label: `${draft.fontFamily} (not shipped)`, stack: "" },
      ];

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
        <LogoField
          value={draft.cobranding.logoUrl}
          onChange={(v) => setField("cobranding", { logoUrl: v })}
        />
        <SelectField
          label="Font family"
          value={draft.fontFamily}
          options={fontOptions}
          onChange={(v) => setField("fontFamily", v)}
        />
        <SelectField
          label="Icon set"
          value={draft.iconSet}
          options={ICON_SETS.map((v) => ({ value: v, label: ICON_SET_LABELS[v] }))}
          onChange={(v) => setField("iconSet", asIconSet(v))}
        />
        <IdentityPreview
          title={draft.pageTitle}
          iconSet={draft.iconSet}
          logoUrl={draft.cobranding.logoUrl}
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

// A cross-section of what the app draws: four nav icons, then the actions every
// dialog and toolbar is built from.
const ICON_SET_LABELS: Record<IconSet, string> = {
  lucide: "Lucide (default)",
  "core-line": "Streamline Core Line",
  "core-solid": "Streamline Core Solid",
  "core-remix": "Streamline Core Remix",
  "core-pop": "Streamline Core Pop (coloured)",
};

const PREVIEW_ICONS: IconName[] = [
  "dashboard",
  "table",
  "image",
  "flask",
  "settings",
  "add",
  "check",
  "delete",
  "close",
  "chevron-down",
];

/**
 * What the two Identity settings actually produce, side by side: the page
 * title set in the chosen face, the weights that face ships, and the icons the
 * nav and the dialogs are built from.
 *
 * No inline font-family here on purpose — applyLive already moved --font-base
 * on <html>, so this row is rendering the real thing rather than a mock-up of
 * it. The weight samples matter because a family can be picked and then turn
 * out to ship only one usable weight.
 */
function IdentityPreview({
  title,
  iconSet,
  logoUrl,
}: {
  title: string;
  iconSet: IconSet;
  logoUrl: string;
}) {
  return (
    <div className="design-tab__preview md:col-span-2 rounded-md border border-slate-200 bg-slate-50 p-4">
      <p className="design-tab__preview-title truncate text-xl font-semibold text-slate-900">
        {title || "MessagingMatrix"}
      </p>
      <p className="design-tab__preview-weights mt-1 text-sm text-slate-600">
        <span className="font-normal">Regular 400</span>
        <span className="mx-1.5 text-slate-300">·</span>
        <span className="font-medium">Medium 500</span>
        <span className="mx-1.5 text-slate-300">·</span>
        <span className="font-bold">Bold 700</span>
      </p>
      {/* The chosen family, not the saved one — the provider around this row
          is what makes the dropdown answer immediately. The rest of the app
          follows on save (router.refresh re-runs the server layout). */}
      <IconSetProvider value={iconSet}>
        <div className="design-tab__preview-icons mt-3 flex flex-wrap items-center gap-3 text-slate-500">
          {logoUrl.trim() ? (
            <>
              {/* The mark as the toolbars will draw it: inverted for the light
                  surface, same as the brand tag. */}
              <img
                src={logoUrl}
                alt=""
                className="design-tab__preview-logo h-4 w-auto max-w-24 object-contain invert"
              />
              <span
                aria-hidden
                className="design-tab__preview-divider text-slate-300"
              >
                |
              </span>
            </>
          ) : null}
          {PREVIEW_ICONS.map((name) => (
            <Icon
              key={name}
              name={name}
              className="design-tab__preview-icon size-4"
            />
          ))}
        </div>
      </IconSetProvider>
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
  hint,
  onChange,
}: {
  label: string;
  value: string;
  hint?: string;
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
      {hint ? (
        <span className="form-field__hint mt-1 block text-xs text-slate-500">
          {hint}
        </span>
      ) : null}
    </label>
  );
}

// The marks this deploy ships. Hand-kept rather than read from public/: it is
// two files, and a build-time directory listing would be a lot of machinery to
// avoid typing a path.
const SHIPPED_LOGOS = ["/erste.svg", "/telekom.svg"];

/**
 * Cobranding logo, next to the page title because that is what it stands in
 * for. There is no on/off switch: an empty field IS off, which removes the
 * state where a logo is configured and silently not shown.
 *
 * The shipped paths live behind an info button rather than in a paragraph of
 * hint text under the input — they are things to pick, not things to read, so
 * clicking one writes it into the field.
 */
function LogoField({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Same dismissal contract as MultiPill and the draft card menu: a click
  // anywhere outside closes, and so does Escape.
  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="form-field logo-field block" ref={ref}>
      <span className="form-field__label mb-1 flex items-center gap-1 text-sm font-medium text-slate-700">
        Cobranding logo
        <span className="logo-field__info relative inline-flex">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-label="Where the shipped logos live"
            aria-expanded={open}
            className="logo-field__info-btn rounded-full p-0.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          >
            <Icon name="info" className="size-3.5" />
          </button>
          {open ? (
            <div className="logo-field__popover absolute left-0 top-6 z-20 w-64 rounded-md border border-slate-200 bg-white p-2 text-xs font-normal shadow-lg">
              <p className="logo-field__popover-text mb-1.5 text-slate-500">
                Shipped with the app — click to use. A white-filled SVG: light
                mode inverts it to black, dark mode shows it as is.
              </p>
              {SHIPPED_LOGOS.map((url) => (
                <button
                  key={url}
                  type="button"
                  onClick={() => {
                    onChange(url);
                    setOpen(false);
                  }}
                  className="logo-field__popover-option block w-full rounded px-1.5 py-1 text-left font-mono text-slate-700 hover:bg-slate-100"
                >
                  {url}
                </button>
              ))}
            </div>
          ) : null}
        </span>
      </span>
      <input
        type="text"
        value={value}
        placeholder="Empty = no logo, the client name shows"
        onChange={(e) => onChange(e.target.value)}
        className="input-box w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-slate-500 focus:outline-none"
      />
    </div>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  onChange: (v: string) => void;
}) {
  return (
    <label className="form-field block">
      <span className="form-field__label mb-1 block text-sm font-medium text-slate-700">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="input-box w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-slate-500 focus:outline-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

