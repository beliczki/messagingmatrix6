"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  ShieldAlert,
  X,
} from "lucide-react";
import clsx from "clsx";

export type AlertVariant = "info" | "success" | "warning" | "danger";

type DialogKind = "alert" | "confirm";

type DialogConfig = {
  title: string;
  /** Body. String → simple paragraph. ReactNode → custom layout (e.g. lists, code). */
  message?: ReactNode;
  variant?: AlertVariant;
  confirmLabel?: string;
  cancelLabel?: string;
};

type InternalDialog = DialogConfig & {
  kind: DialogKind;
  resolve: (value: boolean) => void;
};

type AlertDialogContextValue = {
  alert: (config: DialogConfig | string) => Promise<true>;
  confirm: (config: DialogConfig | string) => Promise<boolean>;
};

const AlertDialogContext = createContext<AlertDialogContextValue | null>(null);

function normalize(config: DialogConfig | string): DialogConfig {
  return typeof config === "string" ? { title: config } : config;
}

export function AlertDialogProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<InternalDialog | null>(null);

  const alert = useCallback((config: DialogConfig | string): Promise<true> => {
    const normalized = normalize(config);
    return new Promise((resolve) => {
      setDialog({
        kind: "alert",
        ...normalized,
        resolve: () => resolve(true),
      });
    });
  }, []);

  const confirm = useCallback(
    (config: DialogConfig | string): Promise<boolean> => {
      const normalized = normalize(config);
      return new Promise((resolve) => {
        setDialog({
          kind: "confirm",
          ...normalized,
          resolve,
        });
      });
    },
    [],
  );

  const close = useCallback(
    (value: boolean) => {
      if (!dialog) return;
      dialog.resolve(value);
      setDialog(null);
    },
    [dialog],
  );

  const value = useMemo(() => ({ alert, confirm }), [alert, confirm]);

  return (
    <AlertDialogContext.Provider value={value}>
      {children}
      <AlertDialog
        dialog={dialog}
        onConfirm={() => close(true)}
        onCancel={() => close(false)}
      />
    </AlertDialogContext.Provider>
  );
}

export function useAlertDialog(): AlertDialogContextValue {
  const ctx = useContext(AlertDialogContext);
  if (!ctx) {
    throw new Error(
      "useAlertDialog must be used inside <AlertDialogProvider>. Wrap the app shell with it.",
    );
  }
  return ctx;
}

const VARIANT_STYLES: Record<
  AlertVariant,
  {
    Icon: typeof Info;
    iconWrap: string;
    confirmBtn: string;
  }
> = {
  info: {
    Icon: Info,
    iconWrap: "alert-dialog__icon--info bg-blue-50 text-blue-600",
    confirmBtn:
      "toolbar-btn--primary bg-slate-900 text-white hover:bg-slate-800",
  },
  success: {
    Icon: CheckCircle2,
    iconWrap: "alert-dialog__icon--success bg-emerald-50 text-emerald-600",
    confirmBtn:
      "toolbar-btn--primary bg-slate-900 text-white hover:bg-slate-800",
  },
  warning: {
    Icon: AlertTriangle,
    iconWrap: "alert-dialog__icon--warning bg-amber-50 text-amber-600",
    confirmBtn:
      "toolbar-btn--primary bg-amber-600 text-white hover:bg-amber-700",
  },
  danger: {
    Icon: ShieldAlert,
    iconWrap: "alert-dialog__icon--danger bg-rose-50 text-rose-600",
    confirmBtn:
      "toolbar-btn--primary bg-rose-600 text-white hover:bg-rose-700",
  },
};

function AlertDialog({
  dialog,
  onConfirm,
  onCancel,
}: {
  dialog: InternalDialog | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!dialog) return;
    confirmBtnRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      } else if (e.key === "Enter") {
        e.preventDefault();
        onConfirm();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialog, onCancel, onConfirm]);

  if (!dialog) return null;

  const variant = dialog.variant ?? (dialog.kind === "confirm" ? "warning" : "info");
  const styles = VARIANT_STYLES[variant];
  const { Icon } = styles;
  const confirmLabel = dialog.confirmLabel ?? (dialog.kind === "confirm" ? "Confirm" : "OK");
  const cancelLabel = dialog.cancelLabel ?? "Cancel";

  return (
    <div
      className="modal-backdrop alert-dialog__backdrop fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
      onClick={onCancel}
      role="presentation"
    >
      <div
        className="modal alert-dialog relative flex w-full max-w-md flex-col gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="alert-dialog-title"
      >
        <button
          type="button"
          onClick={onCancel}
          aria-label="Close dialog"
          className="modal__close absolute right-3 top-3 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
        >
          <X className="size-4" />
        </button>

        <div className="alert-dialog__body flex items-start gap-3">
          <span
            className={clsx(
              "alert-dialog__icon flex size-9 shrink-0 items-center justify-center rounded-full",
              styles.iconWrap,
            )}
            aria-hidden
          >
            <Icon className="size-5" />
          </span>
          <div className="alert-dialog__text min-w-0 flex-1 pt-1">
            <h2
              id="alert-dialog-title"
              className="alert-dialog__title text-sm font-semibold text-slate-900"
            >
              {dialog.title}
            </h2>
            {dialog.message ? (
              <div className="alert-dialog__message mt-1.5 whitespace-pre-line text-xs leading-relaxed text-slate-600">
                {dialog.message}
              </div>
            ) : null}
          </div>
        </div>

        <div className="alert-dialog__actions flex justify-end gap-2 pt-1">
          {dialog.kind === "confirm" ? (
            <button
              type="button"
              onClick={onCancel}
              className="toolbar-btn inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              {cancelLabel}
            </button>
          ) : null}
          <button
            ref={confirmBtnRef}
            type="button"
            onClick={onConfirm}
            className={clsx(
              "inline-flex items-center justify-center rounded-md px-3 py-1.5 text-xs font-medium",
              styles.confirmBtn,
            )}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
