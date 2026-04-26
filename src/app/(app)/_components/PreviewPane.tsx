"use client";

import { useEffect, useRef, useState } from "react";
import {
  Check,
  Sun,
  Moon,
  Grid as GridIcon,
  RefreshCw,
} from "lucide-react";
import clsx from "clsx";

export type PreviewBg = "light" | "dark" | "checker";

type Props = {
  html: string;
  sizes: string[];
  size: string | null;
  onSizeChange: (s: string) => void;
  bg: PreviewBg;
  onBgChange: (b: PreviewBg) => void;
  skipAnim: boolean;
  onSkipAnimChange: (v: boolean) => void;
  onRefresh?: () => void;
  rightExtras?: React.ReactNode;
};

export default function PreviewPane({
  html,
  sizes,
  size,
  onSizeChange,
  bg,
  onBgChange,
  skipAnim,
  onSkipAnimChange,
  onRefresh,
  rightExtras,
}: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!boxRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect;
      if (cr) setBox({ w: cr.width, h: cr.height });
    });
    ro.observe(boxRef.current);
    return () => ro.disconnect();
  }, []);

  function handleRefresh() {
    setReloadKey((k) => k + 1);
    onRefresh?.();
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-3">
        <div className="flex items-center gap-2">
          <select
            value={size ?? ""}
            onChange={(e) => onSizeChange(e.target.value)}
            className="rounded border border-slate-300 bg-white px-2 py-1 text-xs"
            disabled={sizes.length === 0}
          >
            {sizes.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <button
            onClick={() => onSkipAnimChange(!skipAnim)}
            className={clsx(
              "flex items-center gap-1 rounded border px-2 py-1 text-xs",
              skipAnim
                ? "border-slate-900 bg-slate-900 text-white"
                : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
            )}
            title="Skip animations in preview"
          >
            <span
              className={clsx(
                "flex size-3.5 items-center justify-center rounded-sm border",
                skipAnim
                  ? "border-white bg-white text-slate-900"
                  : "border-slate-400",
              )}
            >
              {skipAnim && <Check className="size-2.5" strokeWidth={3} />}
            </span>
            Skip animation
          </button>
        </div>
        <div className="flex items-center gap-1">
          <div className="flex overflow-hidden rounded border border-slate-300">
            <BgBtn active={bg === "light"} onClick={() => onBgChange("light")} title="Light background">
              <Sun className="size-3.5" />
            </BgBtn>
            <BgBtn active={bg === "checker"} onClick={() => onBgChange("checker")} title="Checker background">
              <GridIcon className="size-3.5" />
            </BgBtn>
            <BgBtn active={bg === "dark"} onClick={() => onBgChange("dark")} title="Dark background">
              <Moon className="size-3.5" />
            </BgBtn>
          </div>
          {onRefresh ? (
            <button
              onClick={handleRefresh}
              className="rounded border border-slate-300 bg-white p-1 text-slate-700 hover:bg-slate-50"
              title="Refresh preview"
            >
              <RefreshCw className="size-3.5" />
            </button>
          ) : null}
          {rightExtras}
        </div>
      </div>
      <div
        ref={boxRef}
        className="flex flex-1 items-center justify-center overflow-hidden"
        style={bgStyleFor(bg)}
      >
        <PreviewIframe key={reloadKey} html={html} size={size} box={box} />
      </div>
    </div>
  );
}

function BgBtn({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={clsx(
        "flex items-center justify-center px-1.5 py-1 transition-colors",
        active
          ? "bg-slate-900 text-white"
          : "bg-white text-slate-700 hover:bg-slate-50",
      )}
    >
      {children}
    </button>
  );
}

function bgStyleFor(bg: PreviewBg): React.CSSProperties {
  if (bg === "dark") return { backgroundColor: "#1f2937" };
  if (bg === "checker") {
    return {
      backgroundColor: "#f9fafb",
      backgroundImage:
        "linear-gradient(45deg, #d1d5db 25%, transparent 25%), " +
        "linear-gradient(-45deg, #d1d5db 25%, transparent 25%), " +
        "linear-gradient(45deg, transparent 75%, #d1d5db 75%), " +
        "linear-gradient(-45deg, transparent 75%, #d1d5db 75%)",
      backgroundSize: "20px 20px",
      backgroundPosition: "0 0, 0 10px, 10px -10px, -10px 0px",
    };
  }
  return { backgroundColor: "#ffffff" };
}

function PreviewIframe({
  html,
  size,
  box,
}: {
  html: string;
  size: string | null;
  box: { w: number; h: number };
}) {
  if (!size) return null;
  const m = size.match(/^(\d+)x(\d+)$/);
  if (!m) return null;
  const adW = parseInt(m[1], 10);
  const adH = parseInt(m[2], 10);
  const margin = 16;
  const availW = Math.max(0, box.w - margin * 2);
  const availH = Math.max(0, box.h - margin * 2);
  const scale =
    box.w === 0 || box.h === 0
      ? 1
      : Math.min(1, availW / adW, availH / adH);
  return (
    <iframe
      title="preview"
      srcDoc={html}
      sandbox="allow-same-origin allow-scripts"
      style={{
        width: adW,
        height: adH,
        transform: scale < 1 ? `scale(${scale})` : undefined,
        transformOrigin: "center center",
        border: 0,
        background: "white",
        boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
        flexShrink: 0,
      }}
    />
  );
}
