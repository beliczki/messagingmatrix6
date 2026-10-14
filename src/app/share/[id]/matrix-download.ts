// What a shared DCO cell downloads as: the ad-server-ready HTML5 zip
// (/share/[id]/bundle — the cleanup:bundle transform). A template that
// transform does not know (422) downloads as the single rendered HTML file,
// as before. Used by the detail dialog's Download and by Download all.

export async function fetchMatrixDownload(
  shareId: string,
  message: { id: number; number: number; variant: string },
  size: string,
): Promise<{ blob: Blob | null; filename: string }> {
  const r = await fetch(
    `/share/${shareId}/bundle/${message.id}/${encodeURIComponent(size)}`,
  );
  if (r.ok) {
    // The route always names the zip (the library's creative-name convention).
    const filename = r.headers.get("Content-Disposition")!.match(/filename="([^"]+)"/)![1]!;
    return { blob: await r.blob(), filename };
  }
  const htmlName = `MC${message.number}${message.variant}-${size}.html`;
  if (r.status !== 422) return { blob: null, filename: htmlName };
  const html = await fetch("/api/render/public", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ shareId, messageId: message.id, size, download: true }),
  });
  return { blob: html.ok ? await html.blob() : null, filename: htmlName };
}
