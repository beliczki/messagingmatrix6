import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

// Flat config (ESLint 9). The durable answer to the 6.24.0 filter crash: a hook
// declared after an early return (React #300) is caught statically by
// react-hooks/rules-of-hooks, kept at "error" below. See
// docs/BUGHUNT_2026-08-25_matrix-filter-crash.md (Finding 3).
const eslintConfig = [
  { ignores: [".next/**", ".next-*/**", "node_modules/**", "storage/**", "drizzle/**"] },
  ...nextCoreWebVitals,
  {
    rules: {
      "react-hooks/rules-of-hooks": "error",
      // New in eslint-plugin-react-hooks 7 (Next 16). Existing code was written before
      // them: warn until the findings are worked through (tasks/todo.md tech debt).
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
    },
  },
];

export default eslintConfig;
