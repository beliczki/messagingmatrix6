// Turns the filtered matrix data + parsed tree levels into xyflow nodes/edges.
// Layout: horizontal hierarchy, level 0 leftmost. Within a column nodes are
// stacked vertically in a deterministic order (sorted by label).
//
// Node ID format: `<levelIdx>:<path>` where path is the slash-joined chain of
// group keys from root to this node. This guarantees stable IDs as long as the
// underlying data and tree spec don't change.

import type { Audience, Message, Topic } from "../types";
import type { TreeLevel } from "./parseTreeStructure";

export type TreeNode = {
  id: string;
  level: number;
  label: string;
  count: number;
  // null for level-0 roots, otherwise the id of the parent node. Used by the
  // hierarchical y-layout in TreeView so children cluster under their parent
  // instead of being interleaved alphabetically across the whole column.
  parentId: string | null;
  // Only set on leaf (Messages) nodes.
  messageId?: number;
  // For headline node rendering (audience, topic): the originating entity key,
  // so consumers can look up the full row if needed.
  entityKey?: string;
  // The buying platform shared by EVERY message under this node, when they all
  // share one. Absent when the subtree mixes platforms or carries none, so a
  // consumer can tell "all adform" apart from "mixed" and fall back.
  platform?: string;
};

export type TreeEdge = {
  id: string;
  source: string;
  target: string;
};

export type TreeData = {
  nodes: TreeNode[];
  edges: TreeEdge[];
};

type Row = {
  message: Message;
  audience: Audience;
  topic: Topic;
};

// Extract the value used to group a row at a particular level. Returns "(none)"
// when the underlying field is null/empty, so empty values get their own bucket
// instead of being dropped silently.
function groupValue(level: TreeLevel, row: Row): { key: string; label: string } {
  if (level.kind === "audience") {
    return { key: `aud:${row.audience.key}`, label: row.audience.name || row.audience.key };
  }
  if (level.kind === "topic") {
    return { key: `top:${row.topic.key}`, label: row.topic.name || row.topic.key };
  }
  if (level.kind === "messages") {
    const mc = `MC${row.message.number}${row.message.variant}`;
    return { key: `msg:${row.message.id}`, label: mc };
  }
  // group level
  const entity = level.source === "audience" ? row.audience : row.topic;
  const raw = (entity as unknown as Record<string, unknown>)[level.field];
  const v = raw == null || raw === "" ? "(none)" : String(raw);
  return { key: `${level.source}.${level.field}:${v}`, label: v };
}

export function buildTree(
  data: { auds: Audience[]; tops: Topic[]; msgs: Message[] },
  levels: TreeLevel[],
): TreeData {
  if (levels.length === 0 || data.msgs.length === 0) {
    return { nodes: [], edges: [] };
  }
  const audById = new Map(data.auds.map((a) => [a.key, a]));
  const topById = new Map(data.tops.map((t) => [t.key, t]));

  // Each message yields one root-to-leaf path. We dedupe nodes by their
  // (levelIdx, pathSoFar) cumulative identity.
  type AggNode = {
    id: string;
    level: number;
    label: string;
    rows: Set<number>; // message ids that pass through this node
    platforms: Set<string>; // distinct audience buying platforms below this node
    parentId: string | null;
    messageId?: number;
    entityKey?: string;
  };
  const nodeMap = new Map<string, AggNode>();
  const edgeSet = new Set<string>();

  for (const m of data.msgs) {
    const aud = audById.get(m.audience);
    const top = topById.get(m.topic);
    if (!aud || !top) continue;
    const row: Row = { message: m, audience: aud, topic: top };

    let parentId: string | null = null;
    let pathSoFar = "";
    for (let i = 0; i < levels.length; i++) {
      const level = levels[i];
      const gv = groupValue(level, row);
      pathSoFar = pathSoFar === "" ? gv.key : `${pathSoFar}/${gv.key}`;
      const nodeId = `${i}:${pathSoFar}`;

      let agg = nodeMap.get(nodeId);
      if (!agg) {
        agg = {
          id: nodeId,
          level: i,
          label: gv.label,
          rows: new Set(),
          platforms: new Set(),
          parentId,
        };
        if (level.kind === "messages") agg.messageId = row.message.id;
        if (level.kind === "audience") agg.entityKey = row.audience.key;
        if (level.kind === "topic") agg.entityKey = row.topic.key;
        nodeMap.set(nodeId, agg);
      }
      agg.rows.add(row.message.id);
      if (row.audience.buyingPlatform) {
        agg.platforms.add(row.audience.buyingPlatform);
      }

      if (parentId !== null) {
        edgeSet.add(`${parentId}->${nodeId}`);
      }
      parentId = nodeId;
    }
  }

  // Sort nodes for a deterministic vertical order within each column.
  const nodes: TreeNode[] = [...nodeMap.values()]
    .sort((a, b) => a.level - b.level || a.label.localeCompare(b.label))
    .map((n) => {
      const out: TreeNode = {
        id: n.id,
        level: n.level,
        label: n.label,
        count: n.rows.size,
        parentId: n.parentId,
      };
      if (n.messageId !== undefined) out.messageId = n.messageId;
      if (n.entityKey !== undefined) out.entityKey = n.entityKey;
      if (n.platforms.size === 1) out.platform = [...n.platforms][0];
      return out;
    });

  const edges: TreeEdge[] = [...edgeSet].map((e) => {
    const [source, target] = e.split("->");
    return { id: e, source, target };
  });

  return { nodes, edges };
}
