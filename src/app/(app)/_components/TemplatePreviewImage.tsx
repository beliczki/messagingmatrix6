"use client";

import clsx from "clsx";
import { ExternalLink, ImageOff } from "lucide-react";

// Preview surface for non-html template kinds (adobe / figma / after_effects).
// Renders the template folder's `preview.{png,jpg,…}` via the existing
// `/api/templates/[name]/[file]` route. For kind=figma with an externalUrl,
// the image becomes a link that opens the Figma file in a new tab.
//
// Visual chrome matches the HTML-iframe preview cells (thumb-checker bg) so
// HTML and non-HTML cells line up in the matrix grid without a jarring
// difference.

export type TemplateImageKind = "adobe" | "figma" | "after_effects";

const KIND_LABEL: Record<TemplateImageKind, string> = {
  adobe: "Adobe",
  figma: "Figma",
  after_effects: "AfterEffects",
};

const KIND_MODIFIER: Record<TemplateImageKind, string> = {
  adobe: "template-kind-badge--adobe",
  figma: "template-kind-badge--figma",
  after_effects: "template-kind-badge--after-effects",
};

export function TemplatePreviewImage({
  templateName,
  previewFile,
  kind,
  externalUrl,
  mode,
}: {
  templateName: string;
  previewFile: string | null;
  kind: TemplateImageKind;
  externalUrl: string | null;
  mode: "fill-width" | "fit-rect";
}) {
  const wrapClass =
    mode === "fill-width"
      ? "template-preview-image thumb-checker relative w-full overflow-hidden"
      : "template-preview-image thumb-checker relative size-full overflow-hidden";

  const showLink = kind === "figma" && externalUrl !== null;

  const inner = previewFile ? (
    <img
      src={`/api/templates/${encodeURIComponent(templateName)}/${encodeURIComponent(previewFile)}`}
      alt={`${KIND_LABEL[kind]} preview for ${templateName}`}
      className="template-preview-image__img absolute inset-0 size-full object-contain"
      loading="lazy"
    />
  ) : (
    <div className="template-preview-image__empty flex size-full items-center justify-center text-slate-300">
      <ImageOff className="size-6" />
    </div>
  );

  return (
    <div className={wrapClass}>
      {showLink ? (
        <a
          href={externalUrl!}
          target="_blank"
          rel="noopener noreferrer"
          title={`Open in Figma: ${externalUrl}`}
          className="template-preview-image__link block size-full"
        >
          {inner}
        </a>
      ) : (
        inner
      )}
      <span
        className={clsx(
          "template-kind-badge absolute bottom-1 right-1 inline-flex items-center gap-0.5 rounded border border-slate-200 bg-white/90 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-slate-700 shadow-sm",
          KIND_MODIFIER[kind],
        )}
      >
        {KIND_LABEL[kind]}
        {showLink ? <ExternalLink className="size-2.5" /> : null}
      </span>
    </div>
  );
}
