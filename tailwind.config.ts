import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
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
