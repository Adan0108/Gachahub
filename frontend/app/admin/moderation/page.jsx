"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { FiAlertTriangle, FiArrowRight, FiFileText } from "react-icons/fi";
import { AdminShell } from "../../../components/admin/AdminShell";
import { AdminState } from "../../../components/admin/AdminState";
import { useRequireAdmin } from "../../../hooks/useRequireAdmin";
import { queries } from "../../../lib/queries";
import { REPORT_STATUS_CLASS } from "../../../lib/statusTone";

export default function AdminModerationPage() {
  const session = useRequireAdmin();
  // PENDING is the only status that needs triage attention; IN_REVIEW is already claimed.
  // limit:100 so the preview list only undercounts in an extreme backlog, same bounded-snapshot
  // philosophy as the Overview dashboard's own top-8 communities/activity.
  const reports = useQuery({ ...queries.adminReports("PENDING", 1, 100), enabled: session.isAdmin });
  // Server-side excludeHidden: /admin/content itself still needs to see HIDDEN items to restore them, this hub doesn't.
  const content = useQuery({
    ...queries.adminContent("", 1, { excludeHidden: true, limit: 100 }),
    enabled: session.isAdmin,
  });
  // The headline "unresolved reports" number uses the dashboard's own authoritative count
  // (countOpen, PENDING+IN_REVIEW) rather than this page's own PENDING-only, page-bounded list.
  const overview = useQuery({ ...queries.adminOverview(), enabled: session.isAdmin });

  if (session.isLoading || !session.isAdmin)
    return <AdminState kind="loading" title="Checking admin access" />;

  const loading = reports.isLoading || content.isLoading || overview.isLoading;
  const failed = reports.isError || content.isError || overview.isError;
  const openReports = reports.data?.items || [];
  const flaggedContent = content.data?.items || [];
  const openReportCount =
    overview.data?.metrics.find((metric) => metric.id === "reports")?.value ?? openReports.length;

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
            overview.error?.message ||
            "Moderation data could not be loaded."
          }
          onRetry={() => {
            reports.refetch();
            content.refetch();
            overview.refetch();
          }}
        />
      ) : !openReportCount && !flaggedContent.length ? (
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
                <strong>{openReportCount}</strong>
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
                    <div>
                      <b>{report.reasonCode}</b>
                      <small>
                        {report.targetType} · {report.targetId}
                      </small>
                    </div>
                    <span
                      className={`admin-status ${REPORT_STATUS_CLASS[report.status] || ""}`}
                    >
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
