"use client";

import { useEffect, useState } from "react";

export type Codec<T> = { parse: (s: string) => T; stringify: (v: T) => string };

export const STRING_CODEC: Codec<string> = {
  parse: (s) => s,
  stringify: (s) => s,
};

export const SET_CODEC: Codec<Set<string>> = {
  parse: (s) => new Set(JSON.parse(s) as string[]),
  stringify: (v) => JSON.stringify([...v]),
};

export function usePersistent<T>(key: string, initial: T, codec: Codec<T>) {
  const [value, setValue] = useState<T>(initial);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw !== null) setValue(codec.parse(raw));
    } catch {}
    setHydrated(true);
  }, [key, codec]);
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(key, codec.stringify(value));
    } catch {}
  }, [key, value, hydrated, codec]);
  return [value, setValue] as const;
}
