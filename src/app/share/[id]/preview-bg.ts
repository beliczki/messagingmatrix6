// The app's own preview backgrounds (globals.css `.preview-viewport--*`). A
// class, not an inline style, because the checker has a dark variant there and
// an inline copy of the gradients can never follow the theme. light/dark stay
// fixed on purpose: they are the context you chose to judge the ad against.

export type PreviewBg = "light" | "dark" | "checker";

export function bgClassFor(bg: PreviewBg): string {
  return `preview-viewport--${bg}`;
}
