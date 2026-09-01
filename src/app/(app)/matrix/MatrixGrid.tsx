"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { LayoutList, List, Grip, Table2, ListFilter, Pencil, GitFork } from "lucide-react";
import clsx from "clsx";import { trimEmptyCountSegments } from "@/lib/count-segments";

import { ReactFlowProvider } from "@xyflow/react";
import GridView from "./GridView";
import FeedView from "./FeedView";
import TreeView from "./_views/TreeView";
import TreeViewNavigator, {
  TreeViewNavigatorControls,
} from "./_views/TreeViewNavigator";
import FeedExportPanel from "./FeedExportPanel";
import EditModePanel from "./EditModePanel";
import MatrixExportPanel from "./MatrixExportPanel";
import MatrixToolbar from "./MatrixToolbar";
import MessageEditor from "./MessageEditor";
import CreateMcDialog from "./CreateMcDialog";
import DeleteMcDialog from "./DeleteMcDialog";
import HeaderDetailDialog from "./HeaderDetailDialog";
import RightToolbar from "../_components/RightToolbar";
import CycleIconButton from "../_components/CycleIconButton";
import ArchiveToggle from "../_components/ArchiveToggle";
import {
  type Audience,
  type Channel,
  type Density,
  type Filters,
  type MatrixAxis,
  type Message,
  type Topic,
  type View,
  EMPTY_FILTERS,
  STATUS_OPTIONS,
  channelToAudience,
} from "./types";
import { parseSearchQuery, narrowingAxes } from "@/lib/search-query";

async function fetchJSON<T>(url: string): Promise<T> {
  const r = await fetch(url, { credentials: "include" });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}

async function postJSON<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => r.statusText);
    throw new Error(`${r.status}: ${text}`);
  }
  return r.json();
}

// Bulk copy/move failures arrive as Error("<status>: <json body>") from
// postJSON. Map the structured codes the bulk routes emit to operator-readable
// text; fall back to the raw message for anything unrecognized. labelFor turns
// the server's mc_label (a full PMMID) into the short pill label (MC330a).
function bulkErrorText(
  err: Error,
  labelFor: (mcLabel: string) => string,
): string {
  const body = err.message.replace(/^\d+:\s*/, "");
  try {
    const j = JSON.parse(body) as {
      error?: string;
      mc_label?: string;
      status?: string;
      creative_count?: number;
    };
    const label = j.mc_label ? labelFor(j.mc_label) : "";
    switch (j.error) {
      case "row_locked_by_status":
        return `${label} is ${j.status} — measured cards keep their PMMID and can't be moved or deleted`;
      case "creative_linked":
        return `${label} is the last card carrying that number — ${j.creative_count} creative(s) still link to it, so it can only be archived`;
      case "version_conflict":
        return `${label} changed since the grid loaded — reload and retry`;
      case "not_found":
        return `${label} no longer exists — reload and retry`;
      case "cross_topic_move_not_supported":
        return "Selection spans multiple topics — move works within one topic";
      case "target_audience_not_found":
        return "Target audience not found — reload and retry";
      default:
        return typeof j.error === "string" ? j.error : err.message;
    }
  } catch {
    return err.message;
  }
}

export type Selection = { topic: string | null; mcIds: Set<number> };
export type PendingAction = {
  kind: "copy" | "move";
  targetAudienceKeys: Set<string>;
} | null;

export type EditApi = {
  editMode: boolean;
  setEditMode: (v: boolean) => void;
  selection: Selection;
  toggleSelect: (msg: Message) => void;
  clearSelection: () => void;
  beginPending: (kind: "copy" | "move") => void;
  cancelPending: () => void;
  toggleTargetAudience: (audienceKey: string) => void;
  pendingAction: PendingAction;
  applyPending: () => void;
  /** Opens the archive-or-delete chooser for the current selection. */
  openDeleteDialog: () => void;
  bulkBusy: boolean;
  bulkError: string | null;
};

const STORAGE_KEY = "mm6_matrix_state_v1";

type PersistedState = {
  view: View;
  density: Density;
  transposed: boolean;
  hideInactive: boolean;
  filters: {
    axis?: MatrixAxis;
    products: string[];
    statuses: string[];
    search: string;
  };
};

function loadPersisted(): Partial<PersistedState> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Partial<PersistedState>;
  } catch {
    return {};
  }
}

export default function MatrixWorkspace() {
  const [view, setView] = useState<View>("grid");
  const [density, setDensity] = useState<Density>("detailed");
  const [transposed, setTransposed] = useState<boolean>(true);
  const [hideInactive, setHideInactive] = useState<boolean>(false);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [openMessageId, setOpenMessageId] = useState<number | null>(null);
  // Unpersisted, like every other page's archive toggle — a session starts
  // live-only.
  const [showArchived, setShowArchived] = useState(false);
  // Occupied-cell "+ new" chooser (CreateMcDialog): which cell, and the
  // in-flight/create-error state of the picked option.
  const [createCell, setCreateCell] = useState<{
    audience: string;
    topic: string;
  } | null>(null);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  // Header-level edit action (duplicate an audience/topic). Surfaced through the
  // same edit-mode error banner as the bulk copy/move ops (editApi.bulkError).
  const [headerActionError, setHeaderActionError] = useState<string | null>(
    null,
  );
  // Identified by id, never by key: editing product/tag1..4 regenerates the
  // audience/topic key server-side, and a key-based lookup would then find
  // nothing and unmount the dialog mid-edit. `channel` disambiguates the id:
  // the audience axis also carries channel-derived rows, whose ids come from
  // the channels table and can collide with real audience ids.
  const [headerDialog, setHeaderDialog] = useState<
    { kind: "audience" | "topic"; id: number; channel: string | null } | null
  >(null);
  const [hydrated, setHydrated] = useState(false);

  // Edit-mode state — NOT persisted to localStorage. Mirrors the longpress +
  // selection pattern from CreativeLibrary.tsx:148-193.
  const [editMode, setEditMode] = useState(false);
  const [selection, setSelection] = useState<Selection>({
    topic: null,
    mcIds: new Set(),
  });
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  // Archive-or-delete chooser for the current selection (DeleteMcDialog).
  const [deleteOpen, setDeleteOpen] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    const p = loadPersisted();
    if (p.view === "grid" || p.view === "feed" || p.view === "tree") setView(p.view);
    const persistedDensity = p.density as string | undefined;
    if (persistedDensity === "detailed" || persistedDensity === "compact" || persistedDensity === "dense") {
      setDensity(persistedDensity);
    } else if (persistedDensity === "informative") {
      setDensity("detailed");
    } else if (persistedDensity === "minimal") {
      setDensity("compact");
    }
    if (typeof p.transposed === "boolean") setTransposed(p.transposed);
    if (typeof p.hideInactive === "boolean") setHideInactive(p.hideInactive);
    if (p.filters) {
      setFilters({
        axis: p.filters.axis === "nondco" ? "nondco" : "dco",
        products: new Set(p.filters.products ?? []),
        statuses: new Set(p.filters.statuses ?? []),
        search: p.filters.search ?? "",
      });
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated || typeof window === "undefined") return;
    const payload: PersistedState = {
      view,
      density,
      transposed,
      hideInactive,
      filters: {
        axis: filters.axis,
        products: [...filters.products],
        statuses: [...filters.statuses],
        search: filters.search,
      },
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }, [hydrated, view, density, transposed, hideInactive, filters]);

  const messagesById = useMemo(() => new Map<number, Message>(), []);

  const toggleSelect = useCallback(
    (msg: Message) => {
      setSelection((prev) => {
        if (prev.mcIds.has(msg.id)) {
          const next = new Set(prev.mcIds);
          next.delete(msg.id);
          return next.size === 0
            ? { topic: null, mcIds: next }
            : { topic: prev.topic, mcIds: next };
        }
        if (prev.topic && prev.topic !== msg.topic) {
          // Cross-topic add → reject (first selection pins the topic).
          return prev;
        }
        const next = new Set(prev.mcIds);
        next.add(msg.id);
        return { topic: prev.topic ?? msg.topic, mcIds: next };
      });
    },
    [],
  );

  const clearSelection = useCallback(() => {
    setSelection({ topic: null, mcIds: new Set() });
    setPendingAction(null);
  }, []);

  const beginPending = useCallback((kind: "copy" | "move") => {
    setPendingAction({ kind, targetAudienceKeys: new Set() });
  }, []);

  const cancelPending = useCallback(() => setPendingAction(null), []);

  const toggleTargetAudience = useCallback((audienceKey: string) => {
    setPendingAction((prev) => {
      if (!prev) return prev;
      const next = new Set(prev.targetAudienceKeys);
      if (next.has(audienceKey)) next.delete(audienceKey);
      else if (prev.kind === "move") {
        // Move: single-target. Replace any prior selection.
        next.clear();
        next.add(audienceKey);
      } else {
        next.add(audienceKey);
      }
      return { ...prev, targetAudienceKeys: next };
    });
  }, []);

  // Esc cancels pending action first, then selection. Mirrors CL keyboard UX.
  useEffect(() => {
    if (!editMode) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if (pendingAction) setPendingAction(null);
      else clearSelection();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editMode, pendingAction, clearSelection]);

  // Toggling off the last selected MC clears any pending action — its UI is
  // anchored on having a non-empty selection.
  useEffect(() => {
    if (selection.mcIds.size === 0 && pendingAction) setPendingAction(null);
  }, [selection.mcIds.size, pendingAction]);

  // Leaving edit mode resets everything.
  useEffect(() => {
    if (!editMode) {
      setSelection({ topic: null, mcIds: new Set() });
      setPendingAction(null);
      setHeaderActionError(null);
    }
  }, [editMode]);

  const copyMutation = useMutation({
    mutationFn: (vars: {
      source_mc_labels: string[];
      target_audience_keys: string[];
    }) => postJSON("/api/messages/bulk-copy", vars),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["messages"] });
      clearSelection();
      setEditMode(false);
    },
  });

  const moveMutation = useMutation({
    mutationFn: (vars: {
      moves: { mc_label: string; version: number }[];
      target_audience_key: string;
    }) => postJSON("/api/messages/bulk-move", vars),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["messages"] });
      clearSelection();
      setEditMode(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (vars: {
      mode: "archive" | "purge";
      items: { mc_label: string; version: number }[];
    }) => postJSON("/api/messages/bulk-delete", vars),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["messages"] });
      setDeleteOpen(false);
      clearSelection();
      setEditMode(false);
    },
  });

  // A failed apply's error shouldn't survive into a new pending action, a
  // target change, or an edit-mode re-entry. reset() is referentially stable
  // in react-query v5, so this only fires when those actually change.
  const resetCopy = copyMutation.reset;
  const resetMove = moveMutation.reset;
  const resetDelete = deleteMutation.reset;
  useEffect(() => {
    resetCopy();
    resetMove();
  }, [pendingAction, editMode, resetCopy, resetMove]);

  // Same for the removal chooser: reopening it must not show the previous
  // attempt's error.
  useEffect(() => {
    resetDelete();
  }, [deleteOpen, resetDelete]);

  const audiencesQ = useQuery({
    queryKey: ["audiences"],
    queryFn: () => fetchJSON<{ audiences: Audience[] }>("/api/audiences"),
  });
  const topicsQ = useQuery({
    queryKey: ["topics"],
    queryFn: () => fetchJSON<{ topics: Topic[] }>("/api/topics"),
  });
  const messagesQ = useQuery({
    queryKey: ["messages", { showArchived }],
    queryFn: () =>
      fetchJSON<{ messages: Message[] }>(
        showArchived ? "/api/messages?includeArchived=1" : "/api/messages",
      ),
  });
  const templatesQ = useQuery({
    queryKey: ["templates", "folders"],
    queryFn: () =>
      fetchJSON<{
        templates: { name: string; sizes: string[]; defaultSize: string | null }[];
      }>("/api/templates/folders"),
  });
  const channelsQ = useQuery({
    queryKey: ["channels"],
    queryFn: () => fetchJSON<{ channels: Channel[] }>("/api/channels"),
  });

  // Channels are merged into `audiences` as Audience-shaped rows (channel =
  // code ⇒ nonDCO axis), so the whole DCO/nonDCO column logic below is
  // unchanged — it still partitions a single audience list on channel != null.
  const audiences = useMemo(
    () => [
      ...(audiencesQ.data?.audiences ?? []),
      ...(channelsQ.data?.channels ?? []).map(channelToAudience),
    ],
    [audiencesQ.data, channelsQ.data],
  );
  const topics = topicsQ.data?.topics ?? [];
  const messages = messagesQ.data?.messages ?? [];
  const templates = templatesQ.data?.templates ?? [];

  // Keep the lookup map in sync with the latest messages — referenced inline by
  // bulk handlers below (id → PMMID / version).
  messagesById.clear();
  for (const m of messages) messagesById.set(m.id, m);

  const applyPending = useCallback(() => {
    if (!pendingAction || selection.mcIds.size === 0) return;
    const sources = [...selection.mcIds]
      .map((id) => messagesById.get(id))
      .filter((m): m is Message => !!m);
    const sourcePmmids = sources
      .map((m) => m.pmmid)
      .filter((p): p is string => !!p);
    if (sourcePmmids.length === 0) return;
    const targets = [...pendingAction.targetAudienceKeys];
    if (targets.length === 0) return;

    if (pendingAction.kind === "copy") {
      copyMutation.mutate({
        source_mc_labels: sourcePmmids,
        target_audience_keys: targets,
      });
    } else {
      if (targets.length !== 1) return; // Apply gate enforces this in UI.
      moveMutation.mutate({
        moves: sources
          .filter((m) => m.pmmid)
          .map((m) => ({ mc_label: m.pmmid!, version: m.version })),
        target_audience_key: targets[0],
      });
    }
  }, [pendingAction, selection, messagesById, copyMutation, moveMutation]);

  // Selection snapshot for the removal chooser. A selected cell is one AUDIENCE
  // COPY of a card, not the card: MC290a can sit in 32 audiences and each row
  // carries its own copy of the fields. So the dialog counts per card family
  // (number + variant within one topic — audience copies of the same card) and
  // flags the families whose LAST copy is in the selection, because that is the
  // only case where a purge takes the card's content with it.
  const selectedRows = [...selection.mcIds]
    .map((id) => messagesById.get(id))
    .filter((m): m is Message => !!m);
  const familyKeyOf = (m: Message) => `${m.number}|${m.variant}|${m.topic}`;
  const familySizes = new Map<string, number>();
  for (const m of messages) {
    if (m.archivedAt) continue;
    const k = familyKeyOf(m);
    familySizes.set(k, (familySizes.get(k) ?? 0) + 1);
  }
  const deleteGroups = [
    ...selectedRows
      .reduce((acc, m) => {
        const k = familyKeyOf(m);
        const g = acc.get(k) ?? {
          label: `MC${m.number}${m.variant}`,
          topic: m.topic,
          selected: 0,
          total: familySizes.get(k) ?? 0,
        };
        g.selected += 1;
        acc.set(k, g);
        return acc;
      }, new Map<string, { label: string; topic: string; selected: number; total: number }>())
      .values(),
  ];
  const deleteLocked = selectedRows
    .filter((m) => ["ACTIVE", "INACTIVE", "ARCHIVED"].includes(m.status ?? ""))
    .map((m) => ({ label: `MC${m.number}${m.variant}`, status: m.status ?? "" }));

  const applyDelete = useCallback(
    (mode: "archive" | "purge") => {
      const items = selectedRows
        .filter((m) => m.pmmid)
        .map((m) => ({ mc_label: m.pmmid!, version: m.version }));
      if (items.length === 0) return;
      deleteMutation.mutate({ mode, items });
    },
    [selectedRows, deleteMutation],
  );

  // nonDCO MCs are born only from correctly-named creative uploads, never
  // hand-added in the grid — so edit mode is disabled on the nonDCO axis. The
  // toggle + EditModePanel are swapped for an info box below, and editApi.editMode
  // is forced off here so any add/duplicate affordance already open in GridView
  // vanishes the moment the axis switches to nonDCO.
  const isNonDco = filters.axis === "nondco";

  const editApi: EditApi = useMemo(
    () => ({
      editMode: editMode && !isNonDco,
      setEditMode,
      selection,
      toggleSelect,
      clearSelection,
      beginPending,
      cancelPending,
      toggleTargetAudience,
      pendingAction,
      applyPending,
      openDeleteDialog: () => setDeleteOpen(true),
      bulkBusy:
        copyMutation.isPending ||
        moveMutation.isPending ||
        deleteMutation.isPending,
      bulkError: (() => {
        if (headerActionError) return headerActionError;
        // The removal error belongs to the dialog, not the panel banner.
        const err = copyMutation.error ?? moveMutation.error;
        if (!err) return null;
        return bulkErrorText(err, (mcLabel) => {
          for (const m of messagesById.values())
            if (m.pmmid === mcLabel) return `MC${m.number}${m.variant}`;
          return mcLabel;
        });
      })(),
    }),
    [
      editMode,
      isNonDco,
      selection,
      pendingAction,
      toggleSelect,
      clearSelection,
      beginPending,
      cancelPending,
      toggleTargetAudience,
      applyPending,
      copyMutation.isPending,
      moveMutation.isPending,
      deleteMutation.isPending,
      copyMutation.error,
      moveMutation.error,
      headerActionError,
    ],
  );

  // DnD callback — chooses copy vs move from Ctrl/Meta on the activator event,
  // POSTs to the bulk endpoints. Source set = selection if the dragged MC is in
  // selection, otherwise just the dragged MC.
  const handleDndDrop = useCallback(
    (args: {
      draggedId: number;
      targetAudience: string;
      targetTopic: string;
      copy: boolean;
    }) => {
      const dragged = messagesById.get(args.draggedId);
      if (!dragged) return;
      if (selection.topic && args.targetTopic !== selection.topic) return;

      const isSelected = selection.mcIds.has(args.draggedId);
      const sourceIds = isSelected
        ? [...selection.mcIds]
        : [args.draggedId];
      const sources = sourceIds
        .map((id) => messagesById.get(id))
        .filter((m): m is Message => !!m && !!m.pmmid);
      if (sources.length === 0) return;

      if (args.copy) {
        copyMutation.mutate({
          source_mc_labels: sources.map((m) => m.pmmid!),
          target_audience_keys: [args.targetAudience],
        });
      } else {
        moveMutation.mutate({
          moves: sources.map((m) => ({
            mc_label: m.pmmid!,
            version: m.version,
          })),
          target_audience_key: args.targetAudience,
        });
      }
    },
    [messagesById, selection, copyMutation, moveMutation],
  );

  // Create an MC in a cell. mcNumber: undefined = server default (first
  // number's next variant), a number = that number's next variant or a new
  // number if free on this axis, "new" = force a fresh number (axis max + 1).
  const createInCell = useCallback(
    async (audience: string, topic: string, mcNumber?: number | "new") => {
      setCreateBusy(true);
      setCreateError(null);
      try {
        const { message } = await postJSON<{ message: Message }>(
          "/api/messages",
          {
            audience,
            topic,
            ...(mcNumber !== undefined ? { mc_number: mcNumber } : {}),
          },
        );
        await queryClient.invalidateQueries({ queryKey: ["messages"] });
        setCreateCell(null);
        setOpenMessageId(message.id);
      } catch (e) {
        // postJSON throws Error("<status>: <json>") — surface the body's
        // error field when present.
        const body = (e as Error).message.replace(/^\d+:\s*/, "");
        try {
          const j = JSON.parse(body) as { error?: string };
          setCreateError(typeof j.error === "string" ? j.error : body);
        } catch {
          setCreateError(body);
        }
      } finally {
        setCreateBusy(false);
      }
    },
    [queryClient],
  );

  // Duplicate an audience/topic header (edit mode). Server clones the row only —
  // suffixed key + name, no cells — matching the header-only default. On success
  // the audiences/topics query is refetched so the new column/row appears.
  const duplicateHeader = useCallback(
    async (kind: "audience" | "topic", id: number) => {
      const entity = kind === "audience" ? "audiences" : "topics";
      setHeaderActionError(null);
      try {
        await postJSON(`/api/${entity}/${id}/duplicate`, {});
        await queryClient.invalidateQueries({ queryKey: [entity] });
      } catch (e) {
        const body = (e as Error).message.replace(/^\d+:\s*/, "");
        try {
          const j = JSON.parse(body) as { error?: string };
          setHeaderActionError(typeof j.error === "string" ? j.error : body);
        } catch {
          setHeaderActionError(body);
        }
      }
    },
    [queryClient],
  );

  // Add a new audience/topic header (edit mode). Creates with a default name —
  // the key auto-generates server-side — then refetches and opens the header
  // dialog so the user renames right away (mirrors New-MC opening the editor).
  const addHeader = useCallback(
    async (kind: "audience" | "topic") => {
      const entity = kind === "audience" ? "audiences" : "topics";
      const name = kind === "audience" ? "New audience" : "New topic";
      setHeaderActionError(null);
      try {
        const res = await postJSON<Record<string, { id: number }>>(
          `/api/${entity}`,
          { name },
        );
        await queryClient.invalidateQueries({ queryKey: [entity] });
        const created = res[kind];
        if (created?.id) {
          setHeaderDialog({ kind, id: created.id, channel: null });
        }
      } catch (e) {
        const body = (e as Error).message.replace(/^\d+:\s*/, "");
        try {
          const j = JSON.parse(body) as { error?: string };
          setHeaderActionError(typeof j.error === "string" ? j.error : body);
        } catch {
          setHeaderActionError(body);
        }
      }
    },
    [queryClient],
  );

  // Drag-drop reorder of a header axis (edit mode). `ids` is the new order of
  // the currently visible rows/columns of that dimension; the server permutes
  // them within the orderIndex slots they already occupy. Optimistic-free —
  // we just refetch, the grid re-sorts by orderIndex.
  const handleReorder = useCallback(
    async (kind: "audience" | "topic", ids: number[]) => {
      const entity = kind === "audience" ? "audiences" : "topics";
      setHeaderActionError(null);
      try {
        await postJSON(`/api/${entity}/reorder`, { ids });
        await queryClient.invalidateQueries({ queryKey: [entity] });
      } catch (e) {
        const body = (e as Error).message.replace(/^\d+:\s*/, "");
        try {
          const j = JSON.parse(body) as { error?: string };
          setHeaderActionError(typeof j.error === "string" ? j.error : body);
        } catch {
          setHeaderActionError(body);
        }
      }
    },
    [queryClient],
  );

  // Distinct live MC numbers of the chooser's cell, ascending.
  const createCellNumbers = useMemo(() => {
    if (!createCell) return [];
    const nums = new Set<number>();
    for (const m of messages) {
      if (
        m.audience === createCell.audience &&
        m.topic === createCell.topic &&
        !m.archivedAt &&
        m.status !== "deleted"
      ) {
        nums.add(m.number);
      }
    }
    return [...nums].sort((a, b) => a - b);
  }, [createCell, messages]);

  // nonDCO topic rows are synthesized ON THE FLY from the creative-backed
  // messages — their topic (= the creative-name keyword) is deliberately NOT
  // stored in the DCO `topics` table, which stays reserved for curated DCO
  // topics. Product comes from the topic key's `<PRODUCT>_` prefix; the display
  // name drops that prefix.
  const channelAudienceKeys = useMemo(
    () => new Set(audiences.filter((a) => a.channel != null).map((a) => a.key)),
    [audiences],
  );
  const nonDcoTopics = useMemo(() => {
    const seen = new Map<string, Topic>();
    for (const m of messages) {
      if (!channelAudienceKeys.has(m.audience) || seen.has(m.topic)) continue;
      const i = m.topic.indexOf("_");
      const product = i > 0 ? m.topic.slice(0, i) : null;
      const name = i > 0 ? m.topic.slice(i + 1) : m.topic;
      seen.set(m.topic, {
        key: m.topic,
        name,
        product,
        orderIndex: 0,
      } as Topic);
    }
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [messages, channelAudienceKeys]);

  const productOptions = useMemo(() => {
    const s = new Set<string>();
    for (const a of audiences) if (a.product) s.add(a.product);
    for (const t of topics) if (t.product) s.add(t.product);
    for (const t of nonDcoTopics) if (t.product) s.add(t.product);
    return [...s].sort();
  }, [audiences, topics, nonDcoTopics]);

  // Always offer the full canonical status set so every status is filterable
  // even when no message currently carries it. Any non-canonical status that
  // does exist in the data is appended so nothing in use is ever hidden.
  const statusOptions = useMemo(() => {
    const present = new Set<string>();
    for (const m of messages) if (m.status) present.add(m.status);
    const canonical = STATUS_OPTIONS as readonly string[];
    const extras = [...present].filter((s) => !canonical.includes(s)).sort();
    return [...canonical, ...extras];
  }, [messages]);

  const audienceById = useMemo(
    () => new Map(audiences.map((a) => [a.key, a])),
    [audiences],
  );

  // MC inventory per product for the Product filter menu: how many DCO cells
  // and how many nonDCO ones the product has. Measured over the whole message
  // set, not the current result — a product picker is read to decide where to
  // look, so the numbers must not move as the other filters narrow. DCO/nonDCO
  // is the audience partition (channel == null vs not), the same one the axis
  // switch uses; nonDCO product comes from the topic key prefix, since those
  // channel audiences are product-agnostic.
  const productCounts = useMemo(() => {
    const out: Record<string, number[]> = {};
    const bump = (product: string | null, slot: 0 | 1) => {
      if (!product) return;
      const cur = out[product] ?? [0, 0];
      cur[slot] += 1;
      out[product] = cur;
    };
    for (const m of messages) {
      const a = audienceById.get(m.audience);
      if (!a) continue;
      if (a.channel == null) {
        bump(a.product ?? null, 0);
      } else {
        const i = m.topic.indexOf("_");
        bump(i > 0 ? m.topic.slice(0, i) : null, 1);
      }
    }
    return trimEmptyCountSegments(out, ["DCO", "nonDCO"]);
  }, [messages, audienceById]);

  const topicById = useMemo(
    () => new Map([...topics, ...nonDcoTopics].map((t) => [t.key, t])),
    [topics, nonDcoTopics],
  );

  const filtered = useMemo(() => {
    const ps = filters.products;
    const ss = filters.statuses;
    const predicate = parseSearchQuery(filters.search);
    const axes = narrowingAxes(filters.search);

    // DCO/nonDCO partition on the AUDIENCE axis: nonDCO shows only the prodlist
    // channel-audiences (channel != null), DCO shows only the template-driven
    // ones (channel == null). Messages are pruned by the visible audience keys
    // below, so this single partition carries the whole view. (Topic-axis
    // scoping for auto-topics is deferred to Slice 4, when they exist.)
    const axisAuds = audiences.filter((a) =>
      filters.axis === "nondco" ? a.channel != null : a.channel == null,
    );

    // nonDCO columns are the shared, product-agnostic prodlist channels
    // (ch_disp … ch_yt, product == null), so a product filter must NOT prune
    // them — it only narrows the topic (row) axis there. In DCO every audience
    // carries a product, so the product filter prunes columns as usual.
    let auds =
      ps.size === 0 || filters.axis === "nondco"
        ? axisAuds
        : axisAuds.filter((a) => a.product && ps.has(a.product));
    // nonDCO rows come from the synthesized creative topics; DCO from the table.
    const axisTops = filters.axis === "nondco" ? nonDcoTopics : topics;
    let tops =
      ps.size === 0
        ? axisTops
        : axisTops.filter((t) => t.product && ps.has(t.product));
    // Hide-inactive (corner-cell toggle): drop INACTIVE audience columns and
    // topic rows on both axes before the message prune below, so their MC cells
    // vanish with them. Never touches an MC's own status; archive is separate.
    if (hideInactive) {
      auds = auds.filter((a) => a.status !== "INACTIVE");
      tops = tops.filter((t) => t.status !== "INACTIVE");
    }
    const audKeys = new Set(auds.map((a) => a.key));
    const topKeys = new Set(tops.map((t) => t.key));
    let msgs = messages.filter((m) => audKeys.has(m.audience) && topKeys.has(m.topic));
    if (filters.search.trim()) {
      msgs = msgs.filter((m) => {
        const a = audienceById.get(m.audience);
        const t = topicById.get(m.topic);
        const audience = `${m.audience} ${a?.name ?? ""}`.toLowerCase();
        const topic = `${m.topic} ${t?.name ?? ""}`.toLowerCase();
        const strategy = (a?.strategy ?? "").toLowerCase();
        const platform = (a?.buyingPlatform ?? "").toLowerCase();
        const mc = `mc${m.number}${m.variant} ${m.pmmid ?? ""}`.toLowerCase();
        const free = `${m.name ?? ""} ${m.headline ?? ""} ${m.copy1 ?? ""} ${m.copy2 ?? ""} ${m.disclaimer ?? ""} ${m.cta ?? ""} ${audience} ${topic} ${strategy} ${platform} ${a?.lineitemId ?? ""} ${a?.comment ?? ""} ${t?.comment ?? ""} ${m.pmmid ?? ""}`.toLowerCase();
        return predicate({ audience, topic, strategy, platform, mc, free });
      });
    }
    // Per-status MC counts for the Status filter menu. Measured here, with
    // every OTHER filter applied but the status filter itself still pending —
    // count after it and each selected status would only ever count itself
    // while the unselected ones all read 0. Status and search are independent
    // row predicates, so applying status after search (it used to run before)
    // yields the same set.
    const statusCounts: Record<string, number> = {};
    for (const m of msgs) {
      if (m.status) statusCounts[m.status] = (statusCounts[m.status] ?? 0) + 1;
    }
    if (ss.size > 0) msgs = msgs.filter((m) => m.status && ss.has(m.status));
    // Prune each axis independently: an audience-axis prefix (a:/p:/s:) trims
    // the visible columns, a topic-axis prefix (t:) trims the visible rows, and
    // mc: trims both. The unpruned axis keeps its full set, so e.g. p:adform
    // shows every topic row (empty cells included) under the adform columns.
    if (axes.audience || axes.topic) {
      const usedAudKeys = new Set(msgs.map((m) => m.audience));
      const usedTopKeys = new Set(msgs.map((m) => m.topic));
      if (axes.audience) auds = auds.filter((a) => usedAudKeys.has(a.key));
      if (axes.topic) tops = tops.filter((t) => usedTopKeys.has(t.key));
    }
    return { auds, tops, msgs, statusCounts, axisAudienceCount: axisAuds.length };
  }, [audiences, topics, nonDcoTopics, messages, filters, hideInactive, audienceById, topicById]);

  // Feed export must never see archived rows — the client message list acts
  // as the allowed set gating carry-forward rows server-side, so toggling
  // showArchived must not change export content.
  const feedExportMessages = useMemo(
    () => filtered.msgs.filter((m) => !m.archivedAt),
    [filtered.msgs],
  );

  const openMessage = useMemo(
    () => messages.find((m) => m.id === openMessageId) ?? null,
    [messages, openMessageId],
  );

  // Other audience copies of the open card — drives the editor's global-edit
  // warning, so it must count exactly what propagateToSiblings will write.
  // (number, variant) identifies a card only WITHIN an axis: numbering lets a
  // DCO card share its number with a static nonDCO twin, and those are
  // different cards the fan-out leaves alone.
  const openSiblingCount = useMemo(() => {
    if (!openMessage) return 0;
    const openIsNonDco = channelAudienceKeys.has(openMessage.audience);
    return messages.filter(
      (m) =>
        m.id !== openMessage.id &&
        m.number === openMessage.number &&
        m.variant === openMessage.variant &&
        channelAudienceKeys.has(m.audience) === openIsNonDco,
    ).length;
  }, [openMessage, messages, channelAudienceKeys]);

  const headerEntity = useMemo(() => {
    if (!headerDialog) return null;
    if (headerDialog.kind === "audience") {
      return (
        audiences.find(
          (a) =>
            a.id === headerDialog.id &&
            (a.channel ?? null) === headerDialog.channel,
        ) ?? null
      );
    }
    return topics.find((t) => t.id === headerDialog.id) ?? null;
  }, [headerDialog, audiences, topics]);

  const headerMessages = useMemo(() => {
    if (!headerDialog || !headerEntity) return [];
    return filtered.msgs.filter((m) =>
      headerDialog.kind === "audience"
        ? m.audience === headerEntity.key
        : m.topic === headerEntity.key,
    );
  }, [headerDialog, headerEntity, filtered.msgs]);

  // Same rows, but before the matrix filters — the dialog's delete guard has to
  // count cards of every status, not only the ones currently on screen.
  const headerAllMessages = useMemo(() => {
    if (!headerDialog || !headerEntity) return [];
    return messages.filter((m) =>
      headerDialog.kind === "audience"
        ? m.audience === headerEntity.key
        : m.topic === headerEntity.key,
    );
  }, [headerDialog, headerEntity, messages]);

  const loading = audiencesQ.isLoading || topicsQ.isLoading || messagesQ.isLoading;
  const error = audiencesQ.error || topicsQ.error || messagesQ.error;

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-500">
        Loading matrix…
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-rose-600">
        {(error as Error).message}
      </div>
    );
  }
  if (audiences.length === 0 && topics.length === 0) return <EmptyState />;

  return (
    // ReactFlowProvider wraps the whole matrix so the RightToolbar's
    // NAVIGATOR section can share the xyflow store with the TreeView canvas
    // (MiniMap + zoom Controls rendered outside <ReactFlow>).
    <ReactFlowProvider>
    <div className="matrix flex h-full">
      <div className="matrix__content flex flex-1 flex-col overflow-hidden">
        <MatrixToolbar
          filters={filters}
          setFilters={setFilters}
          productOptions={productOptions}
          statusOptions={statusOptions}
          statusCounts={filtered.statusCounts}
          productCounts={productCounts.counts}
          productCountLabels={productCounts.labels}
          counts={{
            audiences: filtered.axisAudienceCount,
            topics: topics.length,
            messages: messages.length,
            visible: filtered.msgs.length,
            visibleAudiences: filtered.auds.length,
            visibleTopics: filtered.tops.length,
          }}
        />

        <div className="relative flex-1 overflow-hidden">
          {view === "grid" ? (
            <GridView
              audiences={filtered.auds}
              topics={filtered.tops}
              messages={filtered.msgs}
              density={density}
              transposed={transposed}
              setTransposed={setTransposed}
              hideInactive={hideInactive}
              setHideInactive={setHideInactive}
              topicReorderable={filters.axis === "dco"}
              onReorder={handleReorder}
              onOpenMessage={(id) => setOpenMessageId(id)}
              onOpenHeader={(kind, row) =>
                setHeaderDialog({
                  kind,
                  id: row.id,
                  channel: ("channel" in row ? row.channel : null) ?? null,
                })
              }
              editApi={editApi}
              onDndDrop={handleDndDrop}
              onDuplicateHeader={duplicateHeader}
              onAddHeader={addHeader}
              onCreateInCell={(audience, topic) => {
                // Empty cell: instant create as before. Occupied cell: open
                // the chooser — the cell may hold (or gain) several MC
                // numbers, so the user picks a variant target or a new one.
                const occupied = messages.some(
                  (m) =>
                    m.audience === audience &&
                    m.topic === topic &&
                    !m.archivedAt &&
                    m.status !== "deleted",
                );
                if (occupied) {
                  setCreateError(null);
                  setCreateCell({ audience, topic });
                } else {
                  void createInCell(audience, topic);
                }
              }}
            />
          ) : view === "tree" ? (
            <TreeView
              audiences={filtered.auds}
              topics={filtered.tops}
              messages={filtered.msgs}
              onOpenMessage={(id) => setOpenMessageId(id)}
            />
          ) : (
            <FeedView
              messages={filtered.msgs}
              audiences={audiences}
              topics={topics}
              onOpenMessage={(id) => setOpenMessageId(id)}
            />
          )}
        </div>
      </div>

      <RightToolbar storageKey="mm6_matrix_right_toolbar_open">
        {(collapsed) =>
          collapsed ? (
            <>
              <CycleIconButton
                options={[
                  { value: "grid", icon: <Table2 className="size-4" />, label: "Grid view" },
                  { value: "feed", icon: <ListFilter className="size-4" />, label: "Feed view" },
                  { value: "tree", icon: <GitFork className="size-4" />, label: "Decision tree view" },
                ]}
                value={view}
                onChange={setView}
              />
              {view === "grid" ? (
                <CycleIconButton
                  options={[
                    { value: "detailed", icon: <LayoutList className="size-4" />, label: "Detailed" },
                    { value: "compact", icon: <List className="size-4" />, label: "Compact" },
                    { value: "dense", icon: <Grip className="size-4" />, label: "Dense" },
                  ]}
                  value={density}
                  onChange={setDensity}
                />
              ) : null}
              {view === "grid" && !isNonDco ? (
                <button
                  type="button"
                  onClick={() => editApi.setEditMode(!editApi.editMode)}
                  title={editApi.editMode ? "Exit edit mode" : "Enter edit mode"}
                  aria-label="Edit mode"
                  className={clsx(
                    "edit-mode-toggle inline-flex size-8 items-center justify-center rounded",
                    editApi.editMode
                      ? "edit-mode-toggle--active bg-slate-900 text-white hover:bg-slate-800"
                      : "text-slate-700 hover:bg-slate-100",
                  )}
                >
                  <Pencil className="size-4" />
                </button>
              ) : null}
              {view === "tree" ? (
                <TreeViewNavigatorControls orientation="vertical" />
              ) : null}
              <ArchiveToggle
                showArchived={showArchived}
                onChange={setShowArchived}
                collapsed
                className="mt-auto"
              />
            </>
          ) : (
            <div className="flex h-full flex-col gap-3">
              <ViewControls
                view={view}
                setView={setView}
                density={density}
                setDensity={setDensity}
              />
              {view === "grid" ? (
                isNonDco ? (
                  <div className="matrix-nondco-info empty-state rounded-md border border-slate-200 bg-white p-3">
                    <div className="matrix-nondco-info__title text-[10px] font-medium uppercase tracking-wider text-slate-500">
                      nonDCO
                    </div>
                    <div className="matrix-nondco-info__hint mt-1 text-[10px] leading-snug text-slate-500">
                      nonDCO MCs are created automatically when you upload
                      correctly-named creatives to the Creative Library. Upload
                      correctly-named creatives to the Creative Library to see
                      them here.
                    </div>
                  </div>
                ) : (
                  <EditModePanel
                    editApi={editApi}
                    topicNameByKey={topicById}
                  />
                )
              ) : null}
              {view === "grid" ? <MatrixExportPanel filters={filters} /> : null}
              {view === "feed" ? (
                <FeedExportPanel
                  filters={filters}
                  filteredMessages={feedExportMessages}
                />
              ) : null}
              {view === "tree" ? <TreeViewNavigator /> : null}
              <ArchiveToggle
                showArchived={showArchived}
                onChange={setShowArchived}
                className="mt-auto"
              />
            </div>
          )
        }
      </RightToolbar>

      <MessageEditor
        open={!!openMessage}
        message={openMessage}
        audiences={audiences}
        topics={topics}
        visibleMessages={filtered.msgs}
        siblingCount={openSiblingCount}
        onClose={() => setOpenMessageId(null)}
        onJump={(id) => setOpenMessageId(id)}
      />

      {headerDialog && headerEntity ? (
        <HeaderDetailDialog
          kind={headerDialog.kind}
          entity={headerEntity}
          messages={headerMessages}
          allMessages={headerAllMessages}
          templates={templates}
          onClose={() => setHeaderDialog(null)}
          onDeleted={() => {
            const entity =
              headerDialog.kind === "audience" ? "audiences" : "topics";
            setHeaderDialog(null);
            void queryClient.invalidateQueries({ queryKey: [entity] });
          }}
        />
      ) : null}

      <CreateMcDialog
        open={createCell !== null}
        audience={createCell?.audience ?? ""}
        topic={createCell?.topic ?? ""}
        numbers={createCellNumbers}
        busy={createBusy}
        error={createError}
        onPick={(choice) => {
          if (createCell) {
            void createInCell(createCell.audience, createCell.topic, choice);
          }
        }}
        onClose={() => setCreateCell(null)}
      />

      <DeleteMcDialog
        open={deleteOpen && selection.mcIds.size > 0}
        count={selectedRows.length}
        groups={deleteGroups}
        locked={deleteLocked}
        busy={deleteMutation.isPending}
        error={
          deleteMutation.error
            ? bulkErrorText(deleteMutation.error, (mcLabel) => {
                for (const m of messagesById.values())
                  if (m.pmmid === mcLabel) return `MC${m.number}${m.variant}`;
                return mcLabel;
              })
            : null
        }
        onArchive={() => applyDelete("archive")}
        onDelete={() => applyDelete("purge")}
        onClose={() => setDeleteOpen(false)}
      />
    </div>
    </ReactFlowProvider>
  );
}

function ViewControls({
  view,
  setView,
  density,
  setDensity,
}: {
  view: View;
  setView: (v: View) => void;
  density: Density;
  setDensity: (d: Density) => void;
}) {
  return (
    <div className="matrix-view-controls flex flex-col gap-3">
      <div className="matrix-view-controls__section">
        <div className="matrix-view-controls__label mb-1.5 text-[10px] font-medium uppercase tracking-wider text-slate-500">
          View
        </div>
        <div className="toggle-group flex rounded-md border border-slate-200 bg-white p-0.5 text-xs">
          <ToggleBtn active={view === "grid"} onClick={() => setView("grid")}>
            <Table2 className="size-3.5" />
            Grid
          </ToggleBtn>
          <ToggleBtn active={view === "feed"} onClick={() => setView("feed")}>
            <ListFilter className="size-3.5" />
            Feed
          </ToggleBtn>
          <ToggleBtn active={view === "tree"} onClick={() => setView("tree")}>
            <GitFork className="size-3.5" />
            Tree
          </ToggleBtn>
        </div>
      </div>

      {view === "grid" ? (
        <div className="matrix-view-controls__section">
          <div className="matrix-view-controls__label mb-1.5 text-[10px] font-medium uppercase tracking-wider text-slate-500">
            Density
          </div>
          <div className="toggle-group toggle-group--icon-only flex rounded-md border border-slate-200 bg-white p-0.5 text-xs">
            <ToggleBtn
              active={density === "detailed"}
              onClick={() => setDensity("detailed")}
              title="Detailed"
              ariaLabel="Detailed density"
            >
              <LayoutList className="size-4" />
            </ToggleBtn>
            <ToggleBtn
              active={density === "compact"}
              onClick={() => setDensity("compact")}
              title="Compact"
              ariaLabel="Compact density"
            >
              <List className="size-4" />
            </ToggleBtn>
            <ToggleBtn
              active={density === "dense"}
              onClick={() => setDensity("dense")}
              title="Dense"
              ariaLabel="Dense density"
            >
              <Grip className="size-4" />
            </ToggleBtn>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ToggleBtn({
  active,
  onClick,
  children,
  title,
  ariaLabel,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title?: string;
  ariaLabel?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={ariaLabel ?? title}
      className={clsx(
        "toggle-btn flex flex-1 items-center justify-center gap-1.5 rounded px-2 py-1",
        active
          ? "toggle-btn--active bg-slate-900 text-white"
          : "text-slate-700 hover:bg-slate-100",
      )}
    >
      {children}
    </button>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="empty-state matrix-empty-state max-w-md rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
        <h2 className="empty-state__title text-base font-semibold text-slate-900">Empty matrix</h2>
        <p className="empty-state__hint mt-1 text-sm text-slate-500">
          Add an audience and a topic to start. The matrix renders audiences as
          rows and topics as columns; each MC lives at the intersection.
        </p>
        <p className="empty-state__hint mt-3 text-xs text-slate-500">
          For a quick fill from the real Erste data, run:
        </p>
        <pre className="matrix-empty-state__hint mt-1 rounded-md bg-slate-50 p-2 text-left font-mono text-[11px] text-slate-700">
{`ACTIVE_CLIENT_KEY=erste npx tsx \\
  scripts/import-erste-sample.ts`}
        </pre>
      </div>
    </div>
  );
}
