"use client";

import { useMutation } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { FiEyeOff, FiRotateCcw, FiSearch } from "react-icons/fi";
import { AdminActionDialog } from "../../../components/admin/AdminActionDialog";
import { AdminPagination } from "../../../components/admin/AdminPagination";
import { AdminShell } from "../../../components/admin/AdminShell";
import { AdminState } from "../../../components/admin/AdminState";
import { useAdminList } from "../../../hooks/useAdminList";
import { useToast } from "../../../hooks/useToast";
import { api } from "../../../lib/api";
import { queries, queryKeys } from "../../../lib/queries";

const CONTENT_STATUS_CLASS = {
  PUBLISHED: "",
  HIDDEN: "admin-status-hidden",
};

const MODES = {
  hide: {
    title: (item) => `Hide this ${item.type.toLowerCase()}?`,
    description: "It's removed from public view immediately. Moderators can restore it later.",
    confirmLabel: "Hide",
    pendingLabel: "Hiding...",
    tone: "danger",
    notice: "Content hidden",
  },
  restore: {
    title: (item) => `Restore this ${item.type.toLowerCase()}?`,
    description: "It becomes visible to everyone again immediately.",
    confirmLabel: "Restore",
    pendingLabel: "Restoring...",
    tone: "primary",
    notice: "Content restored",
  },
};

export default function AdminContentPage() {
  const { notice, showNotice } = useToast(2400);
  const { session, page, setPage, filters, setFilter, items, meta, invalidate, query } =
    useAdminList((filters, page) => queries.adminContent(filters.type, page), {
      prefix: queryKeys.adminContent.all,
    });
  const [search, setSearch] = useState("");
  // { item, action: "hide" | "restore" } - one target for both actions, since both are just
  // api.hideContent/restoreContent routed by the item's own type and gameSlug.
  const [target, setTarget] = useState(null);

  // `type` is filtered server-side (it's a groupBy filter, nearly free - see
  // ContentModerationService); `search` stays client-side over the fetched
  // page only, since title/content live on two different polymorphic tables
  // with no shared search query.
  const visibleItems = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return items.filter(
      (item) =>
        !needle || `${item.title} ${item.authorName} ${item.id}`.toLowerCase().includes(needle),
    );
  }, [items, search]);

  const mode = target ? MODES[target.action] : null;
  const actionMutation = useMutation({
    mutationFn: () =>
      target.action === "hide" ? api.hideContent(target.item) : api.restoreContent(target.item),
    onSuccess: () => {
      invalidate();
      showNotice(mode.notice);
      setTarget(null);
    },
  });

  if (session.isLoading || !session.isAdmin)
    return <AdminState kind="loading" title="Checking admin access" />;

  return (
    <AdminShell user={session.user}>
      <div className="admin-page-heading">
        <div>
          <span className="admin-eyebrow">Publishing</span>
          <h1>Content management</h1>
          <p>Review reported posts and comments before applying visibility actions.</p>
        </div>
        <span className="admin-page-count">{meta?.total ?? 0} records</span>
      </div>
      <section className="admin-toolbar" aria-label="Content filters">
        <label className="admin-search">
          <FiSearch />
          <input
            aria-label="Search content"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search title, author, or ID"
            value={search}
          />
        </label>
        <select
          aria-label="Filter content type"
          onChange={(event) => setFilter("type", event.target.value)}
          value={filters.type || ""}
        >
          <option value="">All content</option>
          <option value="POST">Posts</option>
          <option value="COMMENT">Comments</option>
        </select>
        <span>{visibleItems.length} shown</span>
      </section>
      {query.isLoading ? (
        <AdminState
          kind="loading"
          title="Loading content"
          message="Retrieving moderation records."
        />
      ) : query.isError ? (
        <AdminState
          kind="error"
          title="Content unavailable"
          message={query.error?.message || "Content records could not be loaded."}
          onRetry={() => query.refetch()}
        />
      ) : !visibleItems.length ? (
        <AdminState
          kind="empty"
          title="No content found"
          message={
            search || filters.type
              ? "Try changing the current filters."
              : "No reported content is waiting on review."
          }
        />
      ) : (
        <section className="admin-panel">
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Content</th>
                  <th>Type</th>
                  <th>Author</th>
                  <th>Reports</th>
                  <th>Status</th>
                  <th className="admin-actions-heading">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visibleItems.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <div className="admin-content-cell">
                        <b>{item.title}</b>
                        <small>{item.id}</small>
                      </div>
                    </td>
                    <td>
                      <span className="admin-type-badge">{item.type}</span>
                    </td>
                    <td>{item.authorName}</td>
                    <td>{item.reportCount}</td>
                    <td>
                      <span
                        className={`admin-status ${CONTENT_STATUS_CLASS[item.status] || ""}`}
                      >
                        {item.status}
                      </span>
                    </td>
                    <td>
                      {item.status === "HIDDEN" ? (
                        <button
                          aria-label={`Restore ${item.type.toLowerCase()} ${item.id}`}
                          className="admin-icon-button"
                          onClick={() => setTarget({ item, action: "restore" })}
                          type="button"
                        >
                          <FiRotateCcw />
                        </button>
                      ) : (
                        <button
                          aria-label={`Hide ${item.type.toLowerCase()} ${item.id}`}
                          className="admin-icon-button admin-icon-danger"
                          onClick={() => setTarget({ item, action: "hide" })}
                          type="button"
                        >
                          <FiEyeOff />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {/* Rendered outside the empty-state branch above: a client-side search filter can empty
          the current page without that being the last page, and the only way back to a page
          that still has matches is the pager - it must never disappear along with the table. */}
      {!query.isLoading && !query.isError && meta ? (
        <AdminPagination page={page} totalPages={meta.totalPages ?? 1} onChange={setPage} />
      ) : null}
      {target ? (
        <AdminActionDialog
          title={mode.title(target.item)}
          description={mode.description}
          error={actionMutation.error?.message}
          pending={actionMutation.isPending}
          confirmLabel={mode.confirmLabel}
          pendingLabel={mode.pendingLabel}
          tone={mode.tone}
          onClose={() => setTarget(null)}
          onConfirm={() => actionMutation.mutate()}
        />
      ) : null}
      {notice ? (
        <div className="toast admin-toast" role="status">
          {notice}
        </div>
      ) : null}
    </AdminShell>
  );
}
