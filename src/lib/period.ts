// Report periods arrive from the platform XLSX front page as
// "DD/MM/YYYY HH:MM:SS" and are stored verbatim, but every other layer speaks
// ISO ("2026-06-01"): agents pass ISO to the MCP report tools, and any ordering
// has to compare dates rather than the stored text — "01/12/2025" sorts AFTER
// "01/05/2026" lexically, which silently inverts a trend across a year end.

/** Collapse either accepted period format to a comparable YYYY-MM-DD key. */
export function periodDateKey(value: string): string | null {
  const s = value.trim();
  const dmy = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/); // DD/MM/YYYY [HH:MM:SS]
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/); // YYYY-MM-DD[...]
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return null;
}
