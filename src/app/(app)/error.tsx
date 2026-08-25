"use client";

import { useEffect } from "react";
import { RotateCcw, RefreshCw } from "lucide-react";

// Route-segment error boundary for the authed app. A render throw inside any
// page under /(app)/ is caught here instead of unmounting the whole tree — the
// layout (sidebar, nav) stays alive and the user gets a way back. Nested below
// (app)/layout.tsx on purpose so the shell survives.
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="app-error flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="app-error__title text-lg font-semibold text-text-primary">
        Something went wrong on this page
      </div>
      <p className="app-error__body max-w-md text-sm text-text-secondary">
        This view hit an unexpected error. The rest of the app is still
        available in the sidebar. Try again, or reload if it persists.
      </p>
      {error?.digest ? (
        <p className="app-error__digest font-mono text-[10px] text-text-tertiary">
          ref: {error.digest}
        </p>
      ) : null}
      <div className="app-error__actions flex gap-2">
        <button
          type="button"
          onClick={() => reset()}
          className="toolbar-btn--primary inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
        >
          <RotateCcw className="size-3.5" />
          Try again
        </button>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600"
        >
          <RefreshCw className="size-3.5" />
          Reload page
        </button>
      </div>
    </div>
  );
}
