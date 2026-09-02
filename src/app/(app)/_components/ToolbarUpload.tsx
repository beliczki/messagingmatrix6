"use client";

import { useState } from "react";
import clsx from "clsx";
import { Loader2, Upload as UploadIcon } from "lucide-react";

/**
 * The upload affordance at the bottom of a right toolbar.
 *
 * One shape, two states, because the rail has two widths: collapsed it is the
 * primary icon button it has always been, and `onActivate` opens whatever big
 * drag-and-drop dialog the page already owns. Expanded there is room for the
 * real thing, so the drop target is right there and files can be dropped
 * without opening anything.
 *
 * The component owns no upload logic — each library does something different
 * with the files (a queue, a metadata dialog, a direct import), so it takes
 * `onFiles` and stays a shell.
 */
export default function ToolbarUpload({
  collapsed = false,
  className,
  label = "Upload",
  help,
  hint = "Click or drop files",
  busy = false,
  onActivate,
  onFiles,
  children,
}: {
  collapsed?: boolean;
  /**
   * Positioning left to the caller, like `ArchiveToggle`: a rail whose archive
   * toggle already claims `mt-auto` must not have a second element claiming it
   * too, or the free space is split between them instead of pooling above.
   */
  className?: string;
  label?: string;
  /** Expanded-only explanation above the drop zone. */
  help?: string;
  /** Expanded-only text inside the drop zone. */
  hint?: string;
  busy?: boolean;
  /** Click, in either state — usually "open the upload dialog". */
  onActivate: () => void;
  /** Files dropped on the expanded zone. */
  onFiles: (files: File[]) => void;
  /** Expanded-only status area under the zone (errors, results). */
  children?: React.ReactNode;
}) {
  const [over, setOver] = useState(false);

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onActivate}
        disabled={busy}
        title={label}
        aria-label={label}
        className={clsx(
          "toolbar-upload__btn toolbar-btn--primary inline-flex size-9 items-center justify-center rounded-md bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50",
          className,
        )}
      >
        {busy ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <UploadIcon className="size-4" />
        )}
      </button>
    );
  }

  return (
    <div className={clsx("toolbar-upload flex flex-col gap-2", className)}>
      <div className="toolbar-upload__header text-[10px] font-medium uppercase tracking-wider text-slate-500">
        {label}
      </div>
      {help ? (
        <p className="toolbar-upload__help text-[11px] leading-snug text-slate-500">
          {help}
        </p>
      ) : null}
      <button
        type="button"
        onClick={onActivate}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const files = Array.from(e.dataTransfer.files ?? []);
          if (files.length > 0) onFiles(files);
        }}
        disabled={busy}
        className={clsx(
          "toolbar-upload__dropzone flex w-full flex-col items-center gap-1.5 rounded-lg border-2 border-dashed px-3 py-5 text-center text-xs transition disabled:opacity-50",
          over
            ? "toolbar-upload__dropzone--over border-slate-500 bg-slate-50 text-slate-900"
            : "border-slate-300 text-slate-600 hover:border-slate-500 hover:bg-slate-50",
        )}
      >
        {busy ? (
          <>
            <Loader2 className="size-5 animate-spin" />
            Uploading…
          </>
        ) : (
          <>
            <UploadIcon className="size-5" />
            {hint}
          </>
        )}
      </button>
      {children}
    </div>
  );
}
