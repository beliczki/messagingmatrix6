"use client";

import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

export type RowSaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "conflict" }
  | { kind: "error"; message: string };

export type Versioned = { id: number; version: number };

type Args = {
  baseUrl: string;
  queryKey: readonly unknown[];
};

export function useRowAutosave<T extends Versioned>({ baseUrl, queryKey }: Args) {
  const qc = useQueryClient();
  const [statesById, setStatesById] = useState<Record<number, RowSaveState>>({});

  const setState = useCallback((id: number, s: RowSaveState) => {
    setStatesById((prev) => ({ ...prev, [id]: s }));
  }, []);

  const save = useCallback(
    async (row: T, patch: Partial<T>): Promise<T | null> => {
      if (Object.keys(patch).length === 0) return row;
      setState(row.id, { kind: "saving" });
      try {
        const r = await fetch(`${baseUrl}/${row.id}`, {
          method: "PATCH",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            "If-Match": String(row.version),
          },
          body: JSON.stringify(patch),
        });
        if (r.status === 409) {
          setState(row.id, { kind: "conflict" });
          await qc.invalidateQueries({ queryKey });
          setTimeout(() => {
            setStatesById((prev) => {
              if (prev[row.id]?.kind === "conflict") {
                const next = { ...prev };
                delete next[row.id];
                return next;
              }
              return prev;
            });
          }, 2000);
          return null;
        }
        if (!r.ok) {
          const msg = await r.text();
          setState(row.id, { kind: "error", message: msg || r.statusText });
          return null;
        }
        const body = (await r.json()) as Record<string, T>;
        const saved = Object.values(body)[0] as T;
        setState(row.id, { kind: "saved" });
        await qc.invalidateQueries({ queryKey });
        setTimeout(() => {
          setStatesById((prev) => {
            if (prev[row.id]?.kind === "saved") {
              const next = { ...prev };
              delete next[row.id];
              return next;
            }
            return prev;
          });
        }, 1500);
        return saved;
      } catch (e) {
        setState(row.id, { kind: "error", message: (e as Error).message });
        return null;
      }
    },
    [baseUrl, queryKey, qc, setState],
  );

  return { statesById, save };
}
