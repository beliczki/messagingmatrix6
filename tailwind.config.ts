import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Theme-aware semantic tokens (shadcn / bizi pattern). Use these
        // instead of hardcoded bg-white / text-slate-700 so dark mode flips
        // automatically via html.dark.
        background: "var(--background)",
        surface: {
          DEFAULT: "var(--surface)",
          elevated: "var(--surface-elevated)",
          alt: "var(--surface-alt)",
        },
        "text-primary": "var(--text-primary)",
        "text-secondary": "var(--text-secondary)",
        "text-tertiary": "var(--text-tertiary)",
        // border-{name} utility — `border-border` for default (used by base
        // *,::before,::after rule), `border-border-strong` / `-subtle` for
        // explicit emphasis.
        border: {
          DEFAULT: "var(--border-default)",
          strong: "var(--border-strong)",
          subtle: "var(--border-subtle)",
        },
        brand: {
          primary: "var(--brand-primary)",
          button: "var(--brand-button)",
          "secondary-1": "var(--brand-secondary-1)",
          "secondary-2": "var(--brand-secondary-2)",
          "secondary-3": "var(--brand-secondary-3)",
          "secondary-4": "var(--brand-secondary-4)",
        },
        status: {
          incoming: "var(--status-incoming)",
          naming: "var(--status-naming)",
          content: "var(--status-content)",
          preview: "var(--status-preview)",
          approved: "var(--status-approved)",
          active: "var(--status-active)",
          inactive: "var(--status-inactive)",
          error: "var(--status-error)",
          dead: "var(--status-dead)",
          memory: "var(--status-memory)",
        },
      },
      fontFamily: {
        sans: ["var(--font-base)", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
