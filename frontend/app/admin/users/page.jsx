"use client";

import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { FiRotateCcw, FiSearch, FiSlash } from "react-icons/fi";
import { AdminActionDialog } from "../../../components/admin/AdminActionDialog";
import { AdminPagination } from "../../../components/admin/AdminPagination";
import { AdminQueryBoundary } from "../../../components/admin/AdminQueryBoundary";
import { AdminShell } from "../../../components/admin/AdminShell";
import { AdminState } from "../../../components/admin/AdminState";
import { useAdminList } from "../../../hooks/useAdminList";
import { useToast } from "../../../hooks/useToast";
import { api } from "../../../lib/api";
import { queries, queryKeys } from "../../../lib/queries";

const USER_STATUS_CLASS = {
  ACTIVE: "",
  SUSPENDED: "admin-status-suspended",
  BANNED: "admin-status-banned",
  DELETED: "admin-status-deleted",
};

const MODES = {
  restrict: {
    title: (user) => `Restrict ${user.name}?`,
    description: "The user loses access immediately. Record a clear reason for the audit history.",
    confirmLabel: "Restrict user",
    pendingLabel: "Restricting...",
    tone: "danger",
    reasonLabel: "Reason *",
    reasonPlaceholder: "Reason recorded for moderators and audit logs",
    reasonRequired: true,
    showRestrictionPicker: true,
  },
  reactivate: {
    title: (user) => `Reactivate ${user.name}?`,
    description: "The user regains access immediately.",
    confirmLabel: "Reactivate user",
    pendingLabel: "Reactivating...",
    tone: "primary",
    reasonLabel: "Reason (optional)",
    reasonPlaceholder: "Optional context for the audit record",
    reasonRequired: false,
    showRestrictionPicker: false,
  },
};

const STATUS_LABEL = { SUSPENDED: "suspended", BANNED: "banned", ACTIVE: "reactivated" };

export default function AdminUsersPage() {
  const { notice, showNotice } = useToast(2400);
  const { session, page, setPage, filters, setFilter, items, meta, invalidate, query } =
    useAdminList(
      (filters, page) => queries.adminUsers(filters.status, filters.search, page),
      { prefix: queryKeys.adminUsers.all },
    );
  // { user, nextStatus: "SUSPENDED" | "BANNED" | "ACTIVE" } - one target for both restrict and
  // reactivate, since both are just api.setUserStatus with a different nextStatus.
  const [target, setTarget] = useState(null);
  const [reason, setReason] = useState("");

  const statusMutation = useMutation({
    mutationFn: () =>
      api.setUserStatus(target.user.id, { status: target.nextStatus, reason: reason.trim() }),
    onSuccess: () => {
      invalidate();
      showNotice(`User ${STATUS_LABEL[target.nextStatus]}`);
      setTarget(null);
      setReason("");
    },
  });

  if (session.isLoading || !session.isAdmin)
    return <AdminState kind="loading" title="Checking admin access" />;

  const openRestrict = (user) => {
    setTarget({ user, nextStatus: "SUSPENDED" });
    setReason("");
  };
  const openReactivate = (user) => {
    setTarget({ user, nextStatus: "ACTIVE" });
    setReason("");
  };
  const mode = target ? MODES[target.nextStatus === "ACTIVE" ? "reactivate" : "restrict"] : null;

  return (
    <AdminShell user={session.user}>
      <div className="admin-page-heading">
        <div>
          <span className="admin-eyebrow">Accounts</span>
          <h1>User management</h1>
          <p>Inspect account standing and apply restrictions.</p>
        </div>
        <span className="admin-page-count">{meta?.total ?? 0} members</span>
      </div>
      <section className="admin-toolbar" aria-label="User filters">
        <label className="admin-search">
          <FiSearch />
          <input
            aria-label="Search users"
            onChange={(event) => setFilter("search", event.target.value)}
            placeholder="Search name or email"
            value={filters.search || ""}
          />
        </label>
        <select
          aria-label="Filter user status"
          onChange={(event) => setFilter("status", event.target.value)}
          value={filters.status || ""}
        >
          <option value="">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="SUSPENDED">Suspended</option>
          <option value="BANNED">Banned</option>
        </select>
        <span>{items.length} shown</span>
      </section>
      <AdminQueryBoundary
        query={query}
        loading={{ title: "Loading users", message: "Retrieving member records." }}
        error={{
          title: "Users unavailable",
          message: query.error?.message || "Member records could not be loaded.",
        }}
        empty={
          !items.length
            ? {
                title: "No users found",
                message:
                  filters.search || filters.status
                    ? "Try changing the current filters."
                    : "No member records are available.",
              }
            : null
        }
      >
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
                  <th className="admin-actions-heading">Actions</th>
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
                      <span className={`admin-status ${USER_STATUS_CLASS[user.status] || ""}`}>
                        {user.status}
                      </span>
                    </td>
                    <td>
                      {new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(
                        new Date(user.createdAt),
                      )}
                    </td>
                    <td>
                      {user.status === "ACTIVE" ? (
                        <button
                          aria-label={`Restrict ${user.name}`}
                          className="admin-icon-button admin-icon-danger"
                          disabled={user.role === "ADMIN"}
                          onClick={() => openRestrict(user)}
                          type="button"
                        >
                          <FiSlash />
                        </button>
                      ) : user.status !== "DELETED" && user.role !== "ADMIN" ? (
                        <button
                          aria-label={`Reactivate ${user.name}`}
                          className="admin-icon-button"
                          onClick={() => openReactivate(user)}
                          type="button"
                        >
                          <FiRotateCcw />
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <AdminPagination page={page} totalPages={meta?.totalPages ?? 1} onChange={setPage} />
        </section>
      </AdminQueryBoundary>
      {target ? (
        <AdminActionDialog
          title={mode.title(target.user)}
          description={mode.description}
          error={statusMutation.error?.message}
          pending={statusMutation.isPending}
          confirmDisabled={mode.reasonRequired && !reason.trim()}
          confirmLabel={mode.confirmLabel}
          pendingLabel={mode.pendingLabel}
          tone={mode.tone}
          onClose={() => setTarget(null)}
          onConfirm={() => statusMutation.mutate()}
        >
          <div className="admin-dialog-fields">
            {mode.showRestrictionPicker ? (
              <label>
                <span>Restriction</span>
                <select
                  onChange={(event) =>
                    setTarget((current) => ({ ...current, nextStatus: event.target.value }))
                  }
                  value={target.nextStatus}
                >
                  <option value="SUSPENDED">Suspend</option>
                  <option value="BANNED">Ban</option>
                </select>
              </label>
            ) : null}
            <label>
              <span>{mode.reasonLabel}</span>
              <textarea
                maxLength={500}
                onChange={(event) => setReason(event.target.value)}
                placeholder={mode.reasonPlaceholder}
                rows={3}
                value={reason}
              />
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
