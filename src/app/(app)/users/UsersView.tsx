"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import ArchiveToggle from "../_components/ArchiveToggle";
import clsx from "clsx";

type User = {
  id: string;
  email: string;
  role: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  lastActive: string | null;
  lastAction: string | null;
  live: boolean;
};

function formatTimestamp(s: string | null): string {
  if (!s) return "—";
  // Mixed sources: presence emits ISO ("…T…Z"); audit_log fallback emits
  // SQLite TEXT ("YYYY-MM-DD HH:MM:SS" UTC). Normalize both to a Date.
  const normalized = s.includes("T") ? s : s.replace(" ", "T") + "Z";
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString();
}

export function UsersView({
  currentUserId,
  inDialog = false,
}: {
  currentUserId: string;
  /** When rendered inside AppDialog, leave room for the floating X close button. */
  inDialog?: boolean;
}) {
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const q = useQuery({
    queryKey: ["users", { showArchived }],
    queryFn: async (): Promise<User[]> => {
      const url = showArchived ? "/api/users?includeArchived=1" : "/api/users";
      const r = await fetch(url);
      if (!r.ok) throw new Error("users fetch failed");
      const data = (await r.json()) as { users: User[] };
      return data.users;
    },
    // Refresh the live dot without manual reload. Server-side presence is
    // authoritative; this just polls for changes.
    refetchInterval: 15_000,
  });

  const archiveM = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/users/${id}`, { method: "DELETE" });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error ?? "archive failed");
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
    },
  });
  const restoreM = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/users/${id}/restore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error ?? "restore failed");
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
    },
  });

  function confirmArchive(u: User) {
    if (!window.confirm(`Archive ${u.email}? They won't be able to log in.`)) return;
    archiveM.mutate(u.id);
  }

  return (
    <>
      <header
        className={clsx(
          "users__header toolbar flex h-12 shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4",
          inDialog && "pr-12",
        )}
      >
        <h1 className="text-lg font-semibold text-slate-900">Users</h1>
        <div className="flex items-center gap-2">
          <ArchiveToggle showArchived={showArchived} onChange={setShowArchived} />
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className="toolbar-btn--primary rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
          >
            Add user
          </button>
        </div>
      </header>

      <div className="users__content flex-1 overflow-auto p-6">
        <div className="users__table-wrap w-full">
          {q.isLoading ? (
            <p className="text-sm text-slate-500">Loading…</p>
          ) : q.isError ? (
            <p className="error-alert rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              Failed to load users.
            </p>
          ) : (q.data ?? []).length === 0 ? (
            <div className="empty-state mx-auto max-w-md rounded-lg border border-dashed border-slate-300 p-8 text-center">
              <p className="text-sm text-slate-500">
                No users yet. Click <strong>Add user</strong> to create one.
              </p>
            </div>
          ) : (
            <table className="users__table w-full table-auto border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-2 py-2 font-medium">Email</th>
                  <th className="px-2 py-2 font-medium">Role</th>
                  <th className="px-2 py-2 font-medium">Created</th>
                  <th className="px-2 py-2 font-medium">Last active</th>
                  <th className="px-2 py-2 font-medium">Last action</th>
                  <th className="px-2 py-2 font-medium">Live</th>
                  <th className="px-2 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {(q.data ?? []).map((u) => {
                  const isMe = u.id === currentUserId;
                  const archived = u.archivedAt !== null;
                  return (
                    <tr
                      key={u.id}
                      className={clsx(
                        "users__row border-b border-slate-100",
                        archived && "row--archived",
                      )}
                    >
                      <td className="px-2 py-2 row--archived__title">
                        {u.email}
                        {isMe ? (
                          <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-emerald-800">
                            you
                          </span>
                        ) : null}
                        {archived ? (
                          <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-800">
                            archived
                          </span>
                        ) : null}
                      </td>
                      <td className="px-2 py-2">
                        <span
                          className={
                            u.role === "admin"
                              ? "rounded bg-slate-900 px-1.5 py-0.5 text-xs font-medium text-white"
                              : "rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-700"
                          }
                        >
                          {u.role}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-xs text-slate-500">
                        {u.createdAt.slice(0, 10)}
                      </td>
                      <td className="px-2 py-2 text-xs text-slate-500">
                        {formatTimestamp(u.lastActive)}
                      </td>
                      <td className="px-2 py-2 text-xs text-slate-500">
                        {u.lastAction ? (
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-700">
                            {u.lastAction}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-2 py-2 text-xs">
                        <span
                          className={clsx(
                            "status-badge inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[11px]",
                            u.live
                              ? "bg-emerald-100 text-emerald-800"
                              : "bg-slate-100 text-slate-600",
                          )}
                        >
                          <span
                            className={clsx(
                              "status-dot size-1.5 rounded-full",
                              u.live ? "bg-emerald-500" : "bg-slate-400",
                            )}
                          />
                          {u.live ? "true" : "false"}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => setEditing(u)}
                          disabled={archived}
                          className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Edit
                        </button>
                        {archived ? (
                          <button
                            type="button"
                            onClick={() => restoreM.mutate(u.id)}
                            disabled={restoreM.isPending}
                            className="ml-2 rounded border border-emerald-200 bg-white px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            Restore
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => confirmArchive(u)}
                            disabled={isMe || archiveM.isPending}
                            title={isMe ? "You can't archive your own user" : ""}
                            className="ml-2 rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            Archive
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {showAdd ? (
        <AddUserModal
          onClose={() => setShowAdd(false)}
          onCreated={() => {
            qc.invalidateQueries({ queryKey: ["users"] });
            setShowAdd(false);
          }}
        />
      ) : null}

      {editing ? (
        <EditUserModal
          user={editing}
          isMe={editing.id === currentUserId}
          onClose={() => setEditing(null)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["users"] });
            setEditing(null);
          }}
        />
      ) : null}
    </>
  );
}

function AddUserModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"admin" | "user">("user");

  const m = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, role }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "create failed");
      return data;
    },
    onSuccess: onCreated,
  });

  return (
    <ModalShell title="Add user" onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          m.mutate();
        }}
      >
        <Field label="Email">
          <input
            type="email"
            required
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="input-box w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-slate-500 focus:outline-none"
          />
        </Field>
        <Field
          label="Initial password"
          hint="Min 8 characters. The user can change it later by being reset here."
        >
          <input
            type="text"
            required
            autoComplete="new-password"
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="input-box w-full rounded-md border border-slate-300 px-2 py-1.5 font-mono text-sm focus:border-slate-500 focus:outline-none"
          />
        </Field>
        <Field label="Role">
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as "admin" | "user")}
            className="input-box w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-slate-500 focus:outline-none"
          >
            <option value="user">user</option>
            <option value="admin">admin</option>
          </select>
        </Field>

        {m.isError ? (
          <p className="error-alert rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {(m.error as Error).message}
          </p>
        ) : null}

        <ModalActions
          onCancel={onClose}
          submitLabel={m.isPending ? "Creating…" : "Create"}
          submitDisabled={m.isPending}
        />
      </form>
    </ModalShell>
  );
}

function EditUserModal({
  user,
  isMe,
  onClose,
  onSaved,
}: {
  user: User;
  isMe: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [role, setRole] = useState(user.role);
  const [newPassword, setNewPassword] = useState("");

  const m = useMutation({
    mutationFn: async () => {
      const patch: { role?: string; password?: string } = {};
      if (role !== user.role) patch.role = role;
      if (newPassword.length > 0) patch.password = newPassword;
      if (Object.keys(patch).length === 0) {
        throw new Error("no changes");
      }
      const r = await fetch(`/api/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "save failed");
      return data;
    },
    onSuccess: onSaved,
  });

  const wouldDemoteSelf = isMe && user.role === "admin" && role !== "admin";

  return (
    <ModalShell title={`Edit ${user.email}`} onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          m.mutate();
        }}
      >
        <Field label="Role">
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            disabled={isMe && user.role === "admin"}
            className="input-box w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-slate-500 focus:outline-none disabled:bg-slate-50 disabled:text-slate-500"
          >
            <option value="user">user</option>
            <option value="admin">admin</option>
          </select>
          {isMe && user.role === "admin" ? (
            <span className="form-field__hint mt-1 block text-xs text-slate-500">
              You can&apos;t demote your own admin role.
            </span>
          ) : null}
        </Field>
        <Field
          label="Reset password"
          hint="Leave blank to keep the current password. Min 8 characters."
        >
          <input
            type="text"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="(unchanged)"
            className="input-box w-full rounded-md border border-slate-300 px-2 py-1.5 font-mono text-sm focus:border-slate-500 focus:outline-none"
          />
        </Field>

        {m.isError ? (
          <p className="error-alert rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {(m.error as Error).message}
          </p>
        ) : null}

        <ModalActions
          onCancel={onClose}
          submitLabel={m.isPending ? "Saving…" : "Save"}
          submitDisabled={m.isPending || wouldDemoteSelf}
        />
      </form>
    </ModalShell>
  );
}

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="modal w-full max-w-md rounded-xl bg-white p-6 shadow-2xl">
        <header className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="modal__close rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Close"
          >
            ×
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="form-field block">
      <span className="form-field__label mb-1 block text-sm font-medium text-slate-700">
        {label}
      </span>
      {children}
      {hint ? (
        <span className="form-field__hint mt-1 block text-xs text-slate-500">
          {hint}
        </span>
      ) : null}
    </label>
  );
}

function ModalActions({
  onCancel,
  submitLabel,
  submitDisabled,
}: {
  onCancel: () => void;
  submitLabel: string;
  submitDisabled: boolean;
}) {
  return (
    <div className="mt-2 flex justify-end gap-2">
      <button
        type="button"
        onClick={onCancel}
        className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
      >
        Cancel
      </button>
      <button
        type="submit"
        disabled={submitDisabled}
        className="toolbar-btn--primary rounded-md bg-brand-button px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {submitLabel}
      </button>
    </div>
  );
}
