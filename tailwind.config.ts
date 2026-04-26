import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: "var(--color-primary)",
        toolbar: "var(--color-toolbar)",
      },
      fontFamily: {
        sans: ["var(--font-family)", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
