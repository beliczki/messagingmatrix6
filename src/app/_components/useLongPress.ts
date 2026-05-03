"use client";

import { useCallback, useRef } from "react";

type Options = {
  /** Milliseconds to hold before firing onLongPress. Default 500ms (matches v5). */
  thresholdMs?: number;
  /** Pixel distance after pointerdown that cancels the long-press. Default 10. */
  movePxLimit?: number;
};

type Handlers = {
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onPointerLeave: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  /** True for the click immediately following a long-press; readers should suppress their click. */
  consumeNextClick: () => boolean;
};

export function useLongPress(
  onLongPress: () => void,
  opts: Options = {},
): Handlers {
  const threshold = opts.thresholdMs ?? 500;
  const moveLimit = opts.movePxLimit ?? 10;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const firedRef = useRef(false);

  const cancel = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    startRef.current = null;
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== undefined && e.button !== 0) return;
      firedRef.current = false;
      startRef.current = { x: e.clientX, y: e.clientY };
      timerRef.current = setTimeout(() => {
        firedRef.current = true;
        timerRef.current = null;
        onLongPress();
      }, threshold);
    },
    [onLongPress, threshold],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const start = startRef.current;
      if (!start || !timerRef.current) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (dx * dx + dy * dy > moveLimit * moveLimit) cancel();
    },
    [cancel, moveLimit],
  );

  const onPointerUp = useCallback(() => cancel(), [cancel]);
  const onPointerLeave = useCallback(() => cancel(), [cancel]);

  const consumeNextClick = useCallback(() => {
    const fired = firedRef.current;
    firedRef.current = false;
    return fired;
  }, []);

  return {
    onPointerDown,
    onPointerUp,
    onPointerLeave,
    onPointerMove,
    consumeNextClick,
  };
}
