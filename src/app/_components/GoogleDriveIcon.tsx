// Shared by the Creative Library's Drive controls and the share page's Drive
// buttons. lucide ships no brand marks, so the Drive glyph is drawn in its
// language: currentColor stroke, round caps and joins, so it sits in a row of
// lucide icons without shouting over them. Geometry and stroke weight are
// copied from public/google-drive-lucide-outline.svg — inlined rather than
// <img>-loaded so it inherits the button's colour and costs no request. Keep
// the two in step when that file changes.
export default function GoogleDriveIcon({
  className = "size-3.5",
}: {
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 22.25"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
      focusable="false"
    >
      <path d="M12,1.2c-2.52,0-3.67,1-4.81,2.93L1.67,13.43c-1.24,2.09-.76,4.48.95,6.28,1.05,1.1,2.29,1.33,3.76,1.33h11.24c1.48,0,2.71-.24,3.76-1.33,1.71-1.81,2.19-4.19.95-6.28l-5.52-9.3c-1.14-1.93-2.29-2.93-4.81-2.93Z" />
      <path d="M8.33,10.77h7.33l-3.67,6.38-3.67-6.38Z" />
      <path d="M3.6,10.77h4.74" />
      <path d="M15.67,10.77l2.39-4.05" />
      <path d="M12,17.15l1.92,3.43" />
    </svg>
  );
}
