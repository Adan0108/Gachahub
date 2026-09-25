"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { FiCheckCircle, FiEye } from "react-icons/fi";
import { AdminActionDialog } from "../../../components/admin/AdminActionDialog";
import { AdminShell } from "../../../components/admin/AdminShell";
import { AdminState } from "../../../components/admin/AdminState";
import { useRequireAdmin } from "../../../hooks/useRequireAdmin";
import { useToast } from "../../../hooks/useToast";
import { api } from "../../../lib/api";
import { queries, queryKeys } from "../../../lib/queries";

export default function AdminReportsPage() {
  const session = useRequireAdmin();
  const queryClient = useQueryClient();
  const { notice, showNotice } = useToast(2400);
  const [status, setStatus] = useState("");
  const [selected, setSelected] = useState(null);
  const [resolution, setResolution] = useState("NO_VIOLATION");
  const [note, setNote] = useState("");
  const reports = useQuery({ ...queries.adminReports(), enabled: session.isAdmin });
  const mutation = useMutation({
    mutationFn: () => api.resolveReport(selected.id, { resolution, note: note.trim() }),
    onSuccess: (result) => {
      queryClient.setQueryData(queryKeys.adminReports, (current) => ({
        ...current,
        items: current.items.map((item) => (item.id === result.id ? { ...item, ...result } : item)),
      }));
      setSelected(null);
      setNote("");
      showNotice("Report resolved");
    },
  });
  const items = useMemo(
    () => (reports.data?.items || []).filter((report) => !status || report.status === status),
    [reports.data, status],
  );

  if (session.isLoading || !session.isAdmin)
    return <AdminState kind="loading" title="Checking admin access" />;

  return (
    <AdminShell user={session.user}>
      <div className="admin-page-heading">
        <div>
          <span className="admin-eyebrow">Safety queue</span>
          <h1>Reports</h1>
          <p>Review reported posts and comments and record a moderation decision.</p>
        </div>
        <span className="admin-page-count">{reports.data?.meta?.total ?? 0} total</span>
      </div>
      <section className="admin-toolbar admin-toolbar-compact" aria-label="Report filters">
        <select
          aria-label="Filter report status"
          onChange={(event) => setStatus(event.target.value)}
          value={status}
        >
          <option value="">All statuses</option>
          <option value="OPEN">Open</option>
          <option value="IN_REVIEW">In review</option>
          <option value="RESOLVED">Resolved</option>
        </select>
        <span>{items.length} shown</span>
      </section>
      {reports.isLoading ? (
        <AdminState
          kind="loading"
          title="Loading reports"
          message="Retrieving the moderation queue."
        />
      ) : reports.isError ? (
        <AdminState
          kind="error"
          title="Reports unavailable"
          message={reports.error?.message || "The report queue could not be loaded."}
          onRetry={() => reports.refetch()}
        />
      ) : !items.length ? (
        <AdminState
          kind="empty"
          title="No reports found"
          message={status ? "No reports match this status." : "The moderation queue is clear."}
        />
      ) : (
        <section className="admin-panel">
          <div className="admin-table-wrap">
            <table className="admin-table admin-report-table">
              <thead>
                <tr>
                  <th>Report ID</th>
                  <th>Target</th>
                  <th>Reason</th>
                  <th>Priority</th>
                  <th>Status</th>
                  <th>Submitted</th>
                  <th className="admin-actions-heading">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((report) => (
                  <tr key={report.id}>
                    <td>
                      <div className="admin-report-id">
                        <span aria-hidden="true">R</span>
                        <code>{report.id}</code>
                      </div>
                    </td>
                    <td>
                      <div className="admin-target-cell">
                        <span className="admin-type-badge">{report.targetType}</span>
                        <code>{report.targetId}</code>
                      </div>
                    </td>
                    <td>
                      <strong className="admin-reason-text">{report.reason}</strong>
                    </td>
                    <td>
                      <span
                        className={`admin-priority admin-priority-${report.priority.toLowerCase()}`}
                      >
                        {report.priority}
                      </span>
                    </td>
                    <td>
                      <span className={`admin-status admin-status-${report.status.toLowerCase()}`}>
                        {report.status.replace("_", " ")}
                      </span>
                    </td>
                    <td>
                      {new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(
                        new Date(report.createdAt),
                      )}
                    </td>
                    <td>
                      <button
                        aria-label={`Review ${report.id}`}
                        className="admin-icon-button"
                        disabled={report.status === "RESOLVED"}
                        onClick={() => {
                          setSelected(report);
                          setResolution("NO_VIOLATION");
                          setNote("");
                        }}
                        type="button"
                      >
                        {report.status === "RESOLVED" ? <FiCheckCircle /> : <FiEye />}
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
          title={`Resolve ${selected.id}`}
          description={`${selected.reason} report against ${selected.targetType.toLowerCase()} ${selected.targetId}.`}
          error={mutation.error?.message}
          pending={mutation.isPending}
          confirmLabel="Resolve report"
          pendingLabel="Resolving..."
          tone="primary"
          onClose={() => setSelected(null)}
          onConfirm={() => mutation.mutate()}
        >
          <div className="admin-dialog-fields">
            <label>
              <span>Decision</span>
              <select onChange={(event) => setResolution(event.target.value)} value={resolution}>
                <option value="NO_VIOLATION">No violation</option>
                <option value="CONTENT_HIDDEN">Content hidden</option>
                <option value="USER_WARNED">User warned</option>
                <option value="ESCALATED">Escalated</option>
              </select>
            </label>
            <label>
              <span>Internal note</span>
              <textarea
                maxLength={1000}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Optional context for the audit record"
                rows={3}
                value={note}
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
