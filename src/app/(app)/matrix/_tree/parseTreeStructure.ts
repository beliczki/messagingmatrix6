// Parses the Settings → Structure → "Decision tree structure" string
// into a typed list of levels the buildTree() consumer can iterate.
//
// Format: arrow-separated levels, e.g. `Product → Strategy → Audience → Topic → Messages`.
// Each level is either:
//   - A special grouping token: `Audience` | `Topic` | `Messages`
//   - A bare field name resolved against the implicit source:
//       audience fields: product, strategy, buyingPlatform, dataSource,
//                        targetingType, device, tag
//       topic fields:    tag1, tag2, tag3, tag4
//   - A `Source.Field` form to disambiguate (e.g. `Topics.Tag1`, `Audiences.Product`)
//
// All matching is case-insensitive. Whitespace around levels and around
// `Source.Field` is trimmed. Unknown levels throw — the UI surfaces the
// message back to the user so they can correct the string.

export type TreeSource = "audience" | "topic" | "message";

export type TreeLevel =
  | { kind: "group"; source: TreeSource; field: string; label: string }
  | { kind: "audience" }
  | { kind: "topic" }
  | { kind: "messages" };

const AUDIENCE_FIELDS: Record<string, string> = {
  product: "product",
  strategy: "strategy",
  buyingplatform: "buyingPlatform",
  "buying platform": "buyingPlatform",
  buying_platform: "buyingPlatform",
  datasource: "dataSource",
  "data source": "dataSource",
  data_source: "dataSource",
  targetingtype: "targetingType",
  "targeting type": "targetingType",
  targeting_type: "targetingType",
  device: "device",
  tag: "tag",
};

const TOPIC_FIELDS: Record<string, string> = {
  tag1: "tag1",
  tag2: "tag2",
  tag3: "tag3",
  tag4: "tag4",
  // `product` and `tag` exist on both audience and topic; the bare form
  // resolves to audience first (see resolveBareField). Use `Topics.Product`
  // to opt into the topic side explicitly.
  product: "product",
  tag: "tag",
};

function resolveSource(raw: string): TreeSource | null {
  const k = raw.trim().toLowerCase();
  if (k === "audience" || k === "audiences") return "audience";
  if (k === "topic" || k === "topics") return "topic";
  if (k === "message" || k === "messages") return "message";
  return null;
}

function resolveAudienceField(raw: string): string | null {
  return AUDIENCE_FIELDS[raw.trim().toLowerCase()] ?? null;
}

function resolveTopicField(raw: string): string | null {
  return TOPIC_FIELDS[raw.trim().toLowerCase()] ?? null;
}

function titleCase(field: string): string {
  // camelCase → "Camel Case", then capitalise.
  const spaced = field.replace(/([a-z])([A-Z])/g, "$1 $2");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function parseTreeStructure(input: string): TreeLevel[] {
  const raw = (input ?? "").trim();
  if (raw === "") return [];

  const segments = raw.split("→").map((s) => s.trim()).filter((s) => s.length > 0);
  const levels: TreeLevel[] = [];

  for (const seg of segments) {
    // Source.Field form
    if (seg.includes(".")) {
      const [sourceRaw, fieldRaw] = seg.split(".", 2).map((s) => s.trim());
      const source = resolveSource(sourceRaw);
      if (source === null) {
        throw new Error(`Unknown source in "${seg}". Use Audiences, Topics, or Messages.`);
      }
      if (source === "message") {
        // No message-level grouping fields supported; messages are always leaves.
        throw new Error(`"${seg}" is not valid — Messages can only appear as a leaf level.`);
      }
      const field =
        source === "audience"
          ? resolveAudienceField(fieldRaw)
          : resolveTopicField(fieldRaw);
      if (field === null) {
        throw new Error(`Unknown field "${fieldRaw}" on ${sourceRaw}.`);
      }
      levels.push({ kind: "group", source, field, label: titleCase(field) });
      continue;
    }

    // Bare tokens: special grouping (Audience/Topic/Messages) or shortcut field.
    const source = resolveSource(seg);
    if (source === "audience") {
      levels.push({ kind: "audience" });
      continue;
    }
    if (source === "topic") {
      levels.push({ kind: "topic" });
      continue;
    }
    if (source === "message") {
      levels.push({ kind: "messages" });
      continue;
    }

    const audField = resolveAudienceField(seg);
    if (audField) {
      levels.push({ kind: "group", source: "audience", field: audField, label: titleCase(audField) });
      continue;
    }
    const topField = resolveTopicField(seg);
    if (topField) {
      levels.push({ kind: "group", source: "topic", field: topField, label: titleCase(topField) });
      continue;
    }
    throw new Error(`Unknown level "${seg}". Use Source.Field to disambiguate.`);
  }

  return levels;
}
