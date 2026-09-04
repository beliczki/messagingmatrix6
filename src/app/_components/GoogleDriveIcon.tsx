// Shared by the Creative Library's Drive controls and the share page's Drive
// buttons. lucide ships no brand marks, so the Drive glyph is drawn in its
// language:
// currentColor stroke, round caps and joins, so it sits in a row of lucide
// icons without shouting over them. Geometry from
// public/google-drive-lucide-outline.svg — inlined rather than <img>-loaded so
// it inherits the button's colour and does not cost a request.
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
      strokeWidth={1.35}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
      focusable="false"
    >
      <path d="M12,.7c-2.65,0-3.85,1.05-5.05,3.08L1.15,13.55c-1.3,2.2-.8,4.7,1,6.6,1.1,1.15,2.4,1.4,3.95,1.4h11.8c1.55,0,2.85-.25,3.95-1.4,1.8-1.9,2.3-4.4,1-6.6l-5.8-9.77c-1.2-2.03-2.4-3.08-5.05-3.08Z" />
      <path d="M8.15,10.75h7.7l-3.85,6.7-3.85-6.7Z" />
      <path d="M3.18,10.75h4.97" />
      <path d="M15.85,10.75l2.51-4.25" />
      <path d="M12,17.45l2.01,3.6" />
    </svg>
  );
}
