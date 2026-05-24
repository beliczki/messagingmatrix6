// Pure constants + types used by both the server-side entity layer
// (`src/lib/entities/keywords.ts`, which pulls in `db` / `better-sqlite3`) and
// client-side React code (Settings → Keywords tab UI). Lives in its own file
// so the client bundle doesn't transitively import the `db` module —
// importing from `entities/keywords.ts` in a "use client" file fails Next.js
// build with "Module not found: Can't resolve 'fs'" because `better-sqlite3`
// is server-only. Mirror of the `text-formatting-scope.ts` split pattern.

export const KEYWORD_FORMS = ["audiences", "topics"] as const;
export type KeywordForm = (typeof KEYWORD_FORMS)[number];

// Allowlist of (form, field) pairs the editor surfaces. Values for any other
// (form, field) are still legal in the table (e.g. seeded from the XLSX for a
// future scope expansion) but won't drive a dropdown until added here.
export const KEYWORD_FIELDS: Record<KeywordForm, readonly string[]> = {
  audiences: [
    "status",
    "product",
    "strategy",
    "buyingPlatform",
    "dataSource",
    "targetingType",
    "device",
  ],
  topics: ["status", "product", "tag1", "tag2", "tag3"],
} as const;
