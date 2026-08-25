import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

// Flat config (ESLint 9). The durable answer to the 6.24.0 filter crash: a hook
// declared after an early return (React #300) is caught statically by
// react-hooks/rules-of-hooks, kept at "error" below. See
// docs/BUGHUNT_2026-08-25_matrix-filter-crash.md (Finding 3).
const eslintConfig = [
  { ignores: [".next/**", "node_modules/**", "storage/**", "drizzle/**"] },
  ...compat.extends("next/core-web-vitals"),
  {
    rules: {
      "react-hooks/rules-of-hooks": "error",
    },
  },
];

export default eslintConfig;
