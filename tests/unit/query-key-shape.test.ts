import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

// A React Query key is a SHAPE CONTRACT: every component that reads `["topics"]`
// reads whatever the component that mounted FIRST put there. TypeScript cannot
// see this — each useQuery declares its own generic, and the key is just a
// string — so a mismatch compiles, passes review, and then breaks on exactly
// one navigation order. A reload lands you on the "right" page first and hides
// it, which is why this keeps coming back.
//
// It has now shipped five times. Twice the symptom was a hard crash
// ("(intermediate value) is not iterable" — spreading the envelope object as if
// it were the array); the other times it was worse, an empty list where
// `.audiences` came back undefined on a bare array and nothing said so.
//
// The rule this encodes: for one key name, either EVERY queryFn stores the API
// envelope (`{ topics: [...] }`) or every one unwraps it. Mixed is the bug. The
// codebase convention is the envelope — unwrap at the use site.
const APP_DIR = path.resolve(process.cwd(), "src/app");

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsxFiles(full));
    else if (full.endsWith(".tsx") || full.endsWith(".ts")) out.push(full);
  }
  return out;
}

type Usage = { key: string; unwraps: boolean; file: string; line: number };

// Each `queryKey: [...]` plus the queryFn that follows it, up to the end of the
// options object. Good enough for the one shape this rule is about: whether the
// fetch result is handed on whole or reduced to one of its properties.
function usagesIn(source: string, file: string): Usage[] {
  const lines = source.split("\n");
  const out: Usage[] = [];
  for (let i = 0; i < lines.length; i++) {
    // The WHOLE literal, not just its first segment: React Query compares the
    // full array, so ["feed-exports", "all"] and ["feed-exports", product] are
    // different cache entries and owe each other no shape.
    const keyMatch = lines[i]!.match(/queryKey:\s*(\[[^\]]*\])/);
    if (!keyMatch) continue;
    const body = lines.slice(i, i + 10).join("\n");
    // Only a queryFn DECLARES a shape. `invalidateQueries({ queryKey })` and
    // friends name the same key without putting anything in the cache.
    const fnAt = body.indexOf("queryFn");
    if (fnAt < 0) continue;
    // `.then((d) => d.topics)` / `.then((d: X) => d.topics)` — the unwrap.
    // MonitoringTable's `.then((d: X) => d)` hands the envelope on, so the dot
    // after `d` is what separates the two.
    const unwraps = /=>\s*[a-z]\.[a-zA-Z_]+\s*[,)]/.test(body.slice(fnAt));
    out.push({
      key: keyMatch[1]!.replace(/\s+/g, " "),
      unwraps,
      file,
      line: i + 1,
    });
  }
  return out;
}

describe("react-query key shape contract", () => {
  it("never stores two different shapes under one key name", () => {
    const usages = tsxFiles(APP_DIR).flatMap((f) =>
      usagesIn(readFileSync(f, "utf8"), path.relative(process.cwd(), f)),
    );
    expect(usages.length).toBeGreaterThan(20); // the scan actually found things

    const byKey = new Map<string, Usage[]>();
    for (const u of usages) {
      byKey.set(u.key, [...(byKey.get(u.key) ?? []), u]);
    }

    const conflicts: string[] = [];
    for (const [key, list] of byKey) {
      if (list.length < 2) continue;
      const shapes = new Set(list.map((u) => u.unwraps));
      if (shapes.size > 1) {
        conflicts.push(
          `${key} is read as two shapes:\n` +
            list
              .map(
                (u) =>
                  `    ${u.file}:${u.line} — ${u.unwraps ? "UNWRAPPED (bare array)" : "envelope"}`,
              )
              .join("\n"),
        );
      }
    }

    expect(conflicts.join("\n\n")).toBe("");
  });
});
