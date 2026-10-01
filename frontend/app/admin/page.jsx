"use client";

import { useQuery } from "@tanstack/react-query";
import { FiArrowDownRight, FiArrowUpRight } from "react-icons/fi";
import { AdminShell } from "../../components/admin/AdminShell";
import { AdminState } from "../../components/admin/AdminState";
import { useRequireAdmin } from "../../hooks/useRequireAdmin";
import { queries } from "../../lib/queries";

function formatMetric(value) {
  return new Intl.NumberFormat("en", {
    notation: value >= 100_000 ? "compact" : "standard",
  }).format(value);
}

export default function AdminPage() {
  const session = useRequireAdmin();
  const overview = useQuery({ ...queries.adminOverview(), enabled: session.isAdmin });

  if (session.isLoading || !session.isAdmin) {
    return (
      <AdminState
        kind="loading"
        title="Checking admin access"
        message="Verifying your account permissions."
      />
    );
  }

  return (
    <AdminShell user={session.user}>
      <div className="admin-page-heading">
        <div>
          <span className="admin-eyebrow">Overview</span>
          <h1>Platform operations</h1>
          <p>Monitor community health, moderation workload, and recent admin activity.</p>
        </div>
        <time>{new Intl.DateTimeFormat("en", { dateStyle: "long" }).format(new Date())}</time>
      </div>

      {overview.isLoading ? (
        <AdminState
          kind="loading"
          title="Loading dashboard"
          message="Gathering the latest platform activity."
        />
      ) : overview.isError ? (
        <AdminState
          kind="error"
          title="Dashboard unavailable"
          message="The admin summary could not be loaded."
          onRetry={() => overview.refetch()}
        />
      ) : !overview.data?.metrics?.length ? (
        <AdminState
          kind="empty"
          title="No dashboard data"
          message="Platform metrics will appear when activity is available."
        />
      ) : (
        <>
          <section aria-label="Platform metrics" className="admin-metric-grid">
            {overview.data.metrics.map((metric) => {
              const improving = metric.trend === "up";
              const TrendIcon = improving ? FiArrowUpRight : FiArrowDownRight;
              return (
                <article className="admin-metric-card" key={metric.id}>
                  <span>{metric.label}</span>
                  <strong>{formatMetric(metric.value)}</strong>
                  <small className={improving ? "positive" : "negative"}>
                    <TrendIcon aria-hidden="true" /> {metric.change}% this month
                  </small>
                </article>
              );
            })}
          </section>

          <div className="admin-overview-grid">
            <section className="admin-panel">
              <div className="admin-panel-heading">
                <div>
                  <span className="admin-eyebrow">Communities</span>
                  <h2>Operational snapshot</h2>
                </div>
                <span>{overview.data.communities.length} tracked</span>
              </div>
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Community</th>
                      <th>Members</th>
                      <th>Open reports</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview.data.communities.map((community) => (
                      <tr key={community.id}>
                        <td>{community.name}</td>
                        <td>{formatMetric(community.members)}</td>
                        <td>{community.reports}</td>
                        <td>
                          <span className="admin-status">{community.status}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="admin-panel">
              <div className="admin-panel-heading">
                <div>
                  <span className="admin-eyebrow">Audit</span>
                  <h2>Recent activity</h2>
                </div>
              </div>
              <ol className="admin-activity-list">
                {overview.data.activity.map((item) => (
                  <li key={item.id}>
                    <span aria-hidden="true" />
                    <div>
                      <b>{item.action}</b>
                      <p>{item.subject}</p>
                    </div>
                    <time>{item.occurredAt}</time>
                  </li>
                ))}
              </ol>
            </section>
          </div>
        </>
      )}
    </AdminShell>
  );
}
