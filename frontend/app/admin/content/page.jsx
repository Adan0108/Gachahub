"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { FiEyeOff, FiSearch } from "react-icons/fi";
import { AdminShell } from "../../../components/admin/AdminShell";
import { AdminState } from "../../../components/admin/AdminState";
import { useRequireAdmin } from "../../../hooks/useRequireAdmin";
import { queries } from "../../../lib/queries";

// Mock-backed, read-only for now. The real API only has per-game hidden-post listing + post
// hide/restore (no comment moderation, no cross-game listing, no report count), so there's
// nothing real to wire the Hide action to yet - see BACKLOG.md "Content page" for the real scope.
export default function AdminContentPage() {
  const session = useRequireAdmin();
  const [search, setSearch] = useState("");
  const [type, setType] = useState("");
  const content = useQuery({ ...queries.adminContent(), enabled: session.isAdmin });
  const items = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (content.data?.items || []).filter(
      (item) =>
        (!type || item.type === type) &&
        (!needle || `${item.title} ${item.authorName} ${item.id}`.toLowerCase().includes(needle)),
    );
  }, [content.data, search, type]);

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
        <span className="admin-page-count">{content.data?.meta?.total ?? 0} records</span>
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
          onChange={(event) => setType(event.target.value)}
          value={type}
        >
          <option value="">All content</option>
          <option value="POST">Posts</option>
          <option value="COMMENT">Comments</option>
        </select>
        <span>{items.length} shown</span>
      </section>
      {content.isLoading ? (
        <AdminState
          kind="loading"
          title="Loading content"
          message="Retrieving moderation records."
        />
      ) : content.isError ? (
        <AdminState
          kind="error"
          title="Content unavailable"
          message={content.error?.message || "Content records could not be loaded."}
          onRetry={() => content.refetch()}
        />
      ) : !items.length ? (
        <AdminState
          kind="empty"
          title="No content found"
          message={
            search || type
              ? "Try changing the current filters."
              : "No content records are available."
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
                {items.map((item) => (
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
                        className={`admin-status ${item.status === "HIDDEN" ? "admin-status-hidden" : ""}`}
                      >
                        {item.status}
                      </span>
                    </td>
                    <td>
                      <button
                        aria-label={`Hide ${item.type.toLowerCase()} ${item.id}`}
                        className="admin-icon-button admin-icon-danger"
                        disabled
                        title="Not wired to the real backend yet - see BACKLOG.md"
                        type="button"
                      >
                        <FiEyeOff />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </AdminShell>
  );
}
