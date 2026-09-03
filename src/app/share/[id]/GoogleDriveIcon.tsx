// lucide ships no brand marks, so the Drive glyph is drawn here — an outline in
// currentColor, so it sits in a row of lucide icons without shouting over them.
// The mark is the Drive triangle with its three seams meeting in the middle.
export default function GoogleDriveIcon({
  className = "size-3.5",
}: {
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
      focusable="false"
    >
      <path d="M12 3 21.5 19.5H2.5Z" />
      <path d="M12 14V3" />
      <path d="m12 14-9.5 5.5" />
      <path d="m12 14 9.5 5.5" />
    </svg>
  );
}
