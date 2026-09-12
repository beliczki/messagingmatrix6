import type { IconSet } from "./types";

/**
 * Streamline Core is CC BY 4.0: usable commercially, but the licence requires
 * naming the source and linking it. lucide (ISC) asks for nothing, so the
 * credit appears only when a Core family is actually in use — and it has to
 * appear on the PUBLIC share page too, which renders the tenant's set.
 */
export function IconCredit({
  iconSet,
  className,
}: {
  iconSet: IconSet;
  className?: string;
}) {
  if (!iconSet.startsWith("core")) return null;
  return (
    <span className={className ?? "icon-credit"}>
      {" · Icons: "}
      <a
        href="https://streamlinehq.com"
        target="_blank"
        rel="noreferrer"
        className="icon-credit__link underline"
      >
        Streamline Core
      </a>
      {" (CC BY 4.0)"}
    </span>
  );
}
