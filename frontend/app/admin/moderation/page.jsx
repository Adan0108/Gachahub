"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { FiAlertTriangle, FiArrowRight, FiFileText, FiShield } from "react-icons/fi";
import { AdminShell } from "../../../components/admin/AdminShell";
import { AdminState } from "../../../components/admin/AdminState";
import { useRequireAdmin } from "../../../hooks/useRequireAdmin";
import { queries } from "../../../lib/queries";

export default function AdminModerationPage() {
  const session = useRequireAdmin();
  const reports = useQuery({ ...queries.adminReports(), enabled: session.isAdmin });
  const content = useQuery({ ...queries.adminContent(), enabled: session.isAdmin });

  if (session.isLoading || !session.isAdmin)
    return <AdminState kind="loading" title="Checking admin access" />;

  const loading = reports.isLoading || content.isLoading;
  const failed = reports.isError || content.isError;
  const openReports = (reports.data?.items || []).filter((item) => item.status !== "RESOLVED");
  const flaggedContent = (content.data?.items || []).filter(
    (item) => item.reportCount > 0 && item.status !== "HIDDEN",
  );

  return (
    <AdminShell user={session.user}>
      <div className="admin-page-heading">
        <div>
          <span className="admin-eyebrow">Trust and safety</span>
          <h1>Moderation center</h1>
          <p>Triage incoming reports and coordinate visibility actions from one workspace.</p>
        </div>
      </div>
      {loading ? (
        <AdminState
          kind="loading"
          title="Loading moderation center"
          message="Gathering queue health and content signals."
        />
      ) : failed ? (
        <AdminState
          kind="error"
          title="Moderation data unavailable"
          message={
            reports.error?.message ||
            content.error?.message ||
            "Moderation data could not be loaded."
          }
          onRetry={() => {
            reports.refetch();
            content.refetch();
          }}
        />
      ) : !openReports.length && !flaggedContent.length ? (
        <AdminState
          kind="empty"
          title="All queues are clear"
          message="There are no unresolved reports or flagged content records."
        />
      ) : (
        <>
          <section className="admin-moderation-summary">
            <article>
              <span>
                <FiAlertTriangle />
              </span>
              <div>
                <small>Unresolved reports</small>
                <strong>{openReports.length}</strong>
              </div>
              <Link href="/admin/reports">
                Open queue <FiArrowRight />
              </Link>
            </article>
            <article>
              <span>
                <FiFileText />
              </span>
              <div>
                <small>Flagged content</small>
                <strong>{flaggedContent.length}</strong>
              </div>
              <Link href="/admin/content">
                Review content <FiArrowRight />
              </Link>
            </article>
            <article>
              <span>
                <FiShield />
              </span>
              <div>
                <small>Highest priority</small>
                <strong>
                  {openReports.some((item) => item.priority === "HIGH") ? "High" : "Normal"}
                </strong>
              </div>
            </article>
          </section>
          <div className="admin-overview-grid">
            <section className="admin-panel">
              <div className="admin-panel-heading">
                <div>
                  <span className="admin-eyebrow">Queue</span>
                  <h2>Needs review</h2>
                </div>
                <Link href="/admin/reports">View all</Link>
              </div>
              <ul className="admin-review-list">
                {openReports.slice(0, 4).map((report) => (
                  <li key={report.id}>
                    <span
                      className={`admin-priority admin-priority-${report.priority.toLowerCase()}`}
                    >
                      {report.priority}
                    </span>
                    <div>
                      <b>{report.reason}</b>
                      <small>
                        {report.targetType} · {report.targetId}
                      </small>
                    </div>
                    <span className={`admin-status admin-status-${report.status.toLowerCase()}`}>
                      {report.status.replace("_", " ")}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
            <section className="admin-panel">
              <div className="admin-panel-heading">
                <div>
                  <span className="admin-eyebrow">Signals</span>
                  <h2>Flagged content</h2>
                </div>
                <Link href="/admin/content">View all</Link>
              </div>
              <ul className="admin-review-list">
                {flaggedContent.slice(0, 4).map((item) => (
                  <li key={item.id}>
                    <span className="admin-type-badge">{item.type}</span>
                    <div>
                      <b>{item.title}</b>
                      <small>{item.authorName}</small>
                    </div>
                    <strong>{item.reportCount} reports</strong>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </>
      )}
    </AdminShell>
  );
}
