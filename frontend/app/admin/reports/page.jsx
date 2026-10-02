"use client";

import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { FiCheckCircle, FiEye, FiFlag } from "react-icons/fi";
import { AdminActionDialog } from "../../../components/admin/AdminActionDialog";
import { AdminPagination } from "../../../components/admin/AdminPagination";
import { AdminQueryBoundary } from "../../../components/admin/AdminQueryBoundary";
import { AdminShell } from "../../../components/admin/AdminShell";
import { AdminState } from "../../../components/admin/AdminState";
import { useAdminList } from "../../../hooks/useAdminList";
import { useToast } from "../../../hooks/useToast";
import { api } from "../../../lib/api";
import { queries, queryKeys } from "../../../lib/queries";
import { REPORT_STATUS_CLASS } from "../../../lib/admin/statusTone";

const DECISIONS = {
  RESOLVE: {
    call: api.resolveReport,
    notice: "Report resolved",
    confirmLabel: "Resolve report",
    pendingLabel: "Resolving...",
  },
  DISMISS: {
    call: api.dismissReport,
    notice: "Report dismissed",
    confirmLabel: "Dismiss report",
    pendingLabel: "Dismissing...",
  },
};

export default function AdminReportsPage() {
  const { notice, showNotice } = useToast(2400);
  const { session, page, setPage, filters, setFilter, items, meta, invalidate, query } =
    useAdminList((filters, page) => queries.adminReports(filters.status, page), {
      prefix: queryKeys.adminReports.all,
    });
  const [selected, setSelected] = useState(null);
  const [decisionKey, setDecisionKey] = useState("RESOLVE");
  const [note, setNote] = useState("");

  const claimMutation = useMutation({
    mutationFn: (report) => api.claimReport(report.game.slug, report.id),
    onSuccess: invalidate,
    onError: (error) => showNotice(error.message || "Could not claim report"),
  });
  const decision = DECISIONS[decisionKey];
  const decisionMutation = useMutation({
    mutationFn: () =>
      decision.call(selected.game.slug, selected.id, { resolutionNote: note.trim() }),
    onSuccess: () => {
      invalidate();
      setSelected(null);
      setNote("");
      showNotice(decision.notice);
    },
  });

  if (session.isLoading || !session.isAdmin)
    return <AdminState kind="loading" title="Checking admin access" />;

  const openDecision = (report) => {
    setSelected(report);
    setDecisionKey("RESOLVE");
    setNote("");
  };

  return (
    <AdminShell user={session.user}>
      <div className="admin-page-heading">
        <div>
          <span className="admin-eyebrow">Safety queue</span>
          <h1>Reports</h1>
          <p>Review reported posts and comments and record a moderation decision.</p>
        </div>
        <span className="admin-page-count">{meta?.total ?? 0} total</span>
      </div>
      <section className="admin-toolbar admin-toolbar-compact" aria-label="Report filters">
        <select
          aria-label="Filter report status"
          onChange={(event) => setFilter("status", event.target.value)}
          value={filters.status || ""}
        >
          <option value="">All statuses</option>
          <option value="PENDING">Pending</option>
          <option value="IN_REVIEW">In review</option>
          <option value="RESOLVED">Resolved</option>
          <option value="DISMISSED">Dismissed</option>
        </select>
        <span>{items.length} shown</span>
      </section>
      <AdminQueryBoundary
        query={query}
        loading={{ title: "Loading reports", message: "Retrieving the moderation queue." }}
        error={{
          title: "Reports unavailable",
          message: query.error?.message || "The report queue could not be loaded.",
        }}
        empty={
          !items.length
            ? {
                title: "No reports found",
                message: filters.status
                  ? "No reports match this status."
                  : "The moderation queue is clear.",
              }
            : null
        }
      >
        <section className="admin-panel">
          <div className="admin-table-wrap">
            <table className="admin-table admin-report-table">
              <thead>
                <tr>
                  <th>Report ID</th>
                  <th>Game</th>
                  <th>Target</th>
                  <th>Reason</th>
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
                    <td>{report.game?.name || report.gameId}</td>
                    <td>
                      <div className="admin-target-cell">
                        <span className="admin-type-badge">{report.targetType}</span>
                        <code>{report.targetId}</code>
                      </div>
                    </td>
                    <td>
                      <strong className="admin-reason-text">{report.reasonCode}</strong>
                    </td>
                    <td>
                      <span
                        className={`admin-status ${REPORT_STATUS_CLASS[report.status] || ""}`}
                      >
                        {report.status.replace("_", " ")}
                      </span>
                    </td>
                    <td>
                      {new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(
                        new Date(report.createdAt),
                      )}
                    </td>
                    <td>
                      {report.status === "PENDING" ? (
                        <button
                          aria-label={`Claim ${report.id}`}
                          className="admin-icon-button"
                          disabled={
                            claimMutation.isPending && claimMutation.variables?.id === report.id
                          }
                          onClick={() => claimMutation.mutate(report)}
                          type="button"
                        >
                          <FiFlag />
                        </button>
                      ) : report.status === "IN_REVIEW" ? (
                        <button
                          aria-label={`Review ${report.id}`}
                          className="admin-icon-button"
                          onClick={() => openDecision(report)}
                          type="button"
                        >
                          <FiEye />
                        </button>
                      ) : (
                        <span className="admin-icon-button" aria-hidden="true">
                          <FiCheckCircle />
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <AdminPagination page={page} totalPages={meta?.totalPages ?? 1} onChange={setPage} />
        </section>
      </AdminQueryBoundary>
      {selected ? (
        <AdminActionDialog
          title={`Close out ${selected.id}`}
          description={`${selected.reasonCode} report against ${selected.targetType.toLowerCase()} ${selected.targetId}.`}
          error={decisionMutation.error?.message}
          pending={decisionMutation.isPending}
          confirmLabel={decision.confirmLabel}
          pendingLabel={decision.pendingLabel}
          tone="primary"
          onClose={() => setSelected(null)}
          onConfirm={() => decisionMutation.mutate()}
        >
          <div className="admin-dialog-fields">
            <label>
              <span>Decision</span>
              <select onChange={(event) => setDecisionKey(event.target.value)} value={decisionKey}>
                <option value="RESOLVE">Resolve (action taken)</option>
                <option value="DISMISS">Dismiss (no action)</option>
              </select>
            </label>
            <label>
              <span>Note</span>
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
