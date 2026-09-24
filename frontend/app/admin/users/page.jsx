"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { FiSearch, FiSlash } from "react-icons/fi";
import { AdminActionDialog } from "../../../components/admin/AdminActionDialog";
import { AdminShell } from "../../../components/admin/AdminShell";
import { AdminState } from "../../../components/admin/AdminState";
import { useRequireAdmin } from "../../../hooks/useRequireAdmin";
import { useToast } from "../../../hooks/useToast";
import { api } from "../../../lib/api";
import { queries, queryKeys } from "../../../lib/queries";

export default function AdminUsersPage() {
  const session = useRequireAdmin();
  const queryClient = useQueryClient();
  const { notice, showNotice } = useToast(2400);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [selected, setSelected] = useState(null);
  const [reason, setReason] = useState("");
  const [durationDays, setDurationDays] = useState(7);
  const users = useQuery({ ...queries.adminUsers(), enabled: session.isAdmin });
  const mutation = useMutation({
    mutationFn: () => api.banUser(selected.id, { reason: reason.trim(), durationDays }),
    onSuccess: (result) => {
      queryClient.setQueryData(queryKeys.adminUsers, (current) => ({
        ...current,
        items: current.items.map((user) => (user.id === result.id ? { ...user, ...result } : user)),
      }));
      setSelected(null);
      setReason("");
      showNotice("User access suspended");
    },
  });
  const items = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (users.data?.items || []).filter(
      (user) =>
        (!status || user.status === status) &&
        (!needle || `${user.name} ${user.email} ${user.id}`.toLowerCase().includes(needle)),
    );
  }, [search, status, users.data]);

  if (session.isLoading || !session.isAdmin)
    return <AdminState kind="loading" title="Checking admin access" />;

  const openBan = (user) => {
    setSelected(user);
    setReason("");
    setDurationDays(7);
  };

  return (
    <AdminShell user={session.user}>
      <div className="admin-page-heading">
        <div>
          <span className="admin-eyebrow">Accounts</span>
          <h1>User management</h1>
          <p>Inspect account standing and apply temporary or permanent restrictions.</p>
        </div>
        <span className="admin-page-count">{users.data?.meta?.total ?? 0} members</span>
      </div>
      <section className="admin-toolbar" aria-label="User filters">
        <label className="admin-search">
          <FiSearch />
          <input
            aria-label="Search users"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search name, email, or ID"
            value={search}
          />
        </label>
        <select
          aria-label="Filter user status"
          onChange={(event) => setStatus(event.target.value)}
          value={status}
        >
          <option value="">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="BANNED">Banned</option>
        </select>
        <span>{items.length} shown</span>
      </section>
      {users.isLoading ? (
        <AdminState kind="loading" title="Loading users" message="Retrieving member records." />
      ) : users.isError ? (
        <AdminState
          kind="error"
          title="Users unavailable"
          message={users.error?.message || "Member records could not be loaded."}
          onRetry={() => users.refetch()}
        />
      ) : !items.length ? (
        <AdminState
          kind="empty"
          title="No users found"
          message={
            search || status
              ? "Try changing the current filters."
              : "No member records are available."
          }
        />
      ) : (
        <section className="admin-panel">
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Joined</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((user) => (
                  <tr key={user.id}>
                    <td>
                      <div className="admin-user-cell">
                        <span>{user.name?.charAt(0)?.toUpperCase() || "U"}</span>
                        <div>
                          <b>{user.name}</b>
                          <small>{user.id}</small>
                        </div>
                      </div>
                    </td>
                    <td>{user.email}</td>
                    <td>
                      <span className="admin-type-badge">{user.role}</span>
                    </td>
                    <td>
                      <span
                        className={`admin-status ${user.status === "ACTIVE" ? "" : "admin-status-banned"}`}
                      >
                        {user.status}
                      </span>
                    </td>
                    <td>
                      {new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(
                        new Date(user.joinedAt),
                      )}
                    </td>
                    <td>
                      <button
                        aria-label={`Ban ${user.name}`}
                        className="admin-icon-button admin-icon-danger"
                        disabled={user.status === "BANNED"}
                        onClick={() => openBan(user)}
                        type="button"
                      >
                        <FiSlash />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {selected ? (
        <AdminActionDialog
          title={`Restrict ${selected.name}?`}
          description="The user will lose access for the selected duration. Record a clear reason for the audit history."
          error={mutation.error?.message}
          pending={mutation.isPending}
          confirmDisabled={!reason.trim()}
          confirmLabel="Restrict user"
          pendingLabel="Restricting..."
          onClose={() => setSelected(null)}
          onConfirm={() => mutation.mutate()}
        >
          <div className="admin-dialog-fields">
            <label>
              <span>Reason *</span>
              <textarea
                maxLength={500}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Reason recorded for moderators and audit logs"
                rows={3}
                value={reason}
              />
            </label>
            <label>
              <span>Duration</span>
              <select
                onChange={(event) =>
                  setDurationDays(event.target.value ? Number(event.target.value) : null)
                }
                value={durationDays ?? ""}
              >
                <option value="1">1 day</option>
                <option value="7">7 days</option>
                <option value="30">30 days</option>
                <option value="">Permanent</option>
              </select>
            </label>
          </div>
        </AdminActionDialog>
      ) : null}
      {notice ? (
        <div className="toast admin-toast" role="status">
          {notice}
        </div>
      ) : null}
    </AdminShell>
  );
}
