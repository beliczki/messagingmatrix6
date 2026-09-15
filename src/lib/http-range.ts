// RFC 9110 §14 `Range` parsing, limited to a single `bytes` range — which is
// all any browser asks for when streaming media. A multi-range request is
// answered with the whole body (200), which is always a valid response.

export type ParsedRange =
  | { kind: "none" }
  | { kind: "unsatisfiable" }
  | { kind: "range"; start: number; end: number };

export function parseRangeHeader(
  header: string | null | undefined,
  totalBytes: number,
): ParsedRange {
  if (!header) return { kind: "none" };

  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return { kind: "none" };

  const [, startRaw, endRaw] = m;
  if (startRaw === "" && endRaw === "") return { kind: "none" };
  // An empty object can satisfy no range at all.
  if (totalBytes <= 0) return { kind: "unsatisfiable" };

  const last = totalBytes - 1;

  // Suffix form — `bytes=-500` means the LAST 500 bytes. This is the one the
  // browser uses to find the moov atom of a non-faststart MP4.
  if (startRaw === "") {
    const suffix = Number(endRaw);
    if (suffix <= 0) return { kind: "unsatisfiable" };
    return { kind: "range", start: Math.max(0, totalBytes - suffix), end: last };
  }

  const start = Number(startRaw);
  if (start > last) return { kind: "unsatisfiable" };
  const end = endRaw === "" ? last : Math.min(Number(endRaw), last);
  if (end < start) return { kind: "unsatisfiable" };
  return { kind: "range", start, end };
}
