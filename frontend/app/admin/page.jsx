"use client";

import { useQuery } from "@tanstack/react-query";
import { AdminQueryBoundary } from "../../components/admin/AdminQueryBoundary";
import { AdminShell } from "../../components/admin/AdminShell";
import { AdminState } from "../../components/admin/AdminState";
import { useNowTick } from "../../hooks/useNowTick";
import { useRequireAdmin } from "../../hooks/admin/useRequireAdmin";
import { relativeTime } from "../../lib/time";
import { queries } from "../../lib/queries";

function formatMetric(value) {
  return new Intl.NumberFormat("en", {
    notation: value >= 100_000 ? "compact" : "standard",
  }).format(value);
}

const METRIC_LABEL = {
  members: "Total members",
  communities: "Active communities",
  reports: "Open reports",
  moderators: "Game moderators",
};

const AUDIT_ACTION_LABEL = {
  POST_HIDDEN: "Post hidden",
  POST_RESTORED: "Post restored",
  COMMENT_HIDDEN: "Comment hidden",
  COMMENT_RESTORED: "Comment restored",
  REPORT_CLAIMED: "Report claimed",
  REPORT_RESOLVED: "Report resolved",
  REPORT_DISMISSED: "Report dismissed",
  MODERATOR_ASSIGNED: "Moderator assigned",
  MODERATOR_REMOVED: "Moderator removed",
  USER_BANNED: "User banned",
  USER_SUSPENDED: "User suspended",
  USER_REACTIVATED: "User reactivated",
};

// Builds the activity line's subject from the backend's resolved data (targetName is a post
// title, a comment's parent post id, a report's own target, or a banned user's name - never
// prose) plus the English wording around it, which belongs here, not in the API response.
function describeTarget(item) {
  switch (item.targetType) {
    case "POST":
      return item.targetName ? `Post: ${item.targetName}` : `Post ${item.targetId}`;
    case "COMMENT":
      return item.targetName
        ? `Comment on post ${item.targetName}`
        : `Comment ${item.targetId}`;
    case "REPORT":
      return item.targetName || `Report ${item.targetId}`;
    case "USER":
      return item.targetName ? `User: ${item.targetName}` : `User ${item.targetId}`;
    default:
      return `${item.targetType} ${item.targetId}`;
  }
}

export default function AdminPage() {
  const session = useRequireAdmin();
  const overview = useQuery({ ...queries.adminOverview(), enabled: session.isAdmin });
  // Coarse tick so "2m ago" in the activity feed doesn't go stale while this page sits open.
  useNowTick(60_000);

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

      {/* No `empty` case: getOverview always returns a fixed four-metric array, so there's
          nothing for an empty state to catch here that the error branch doesn't already. */}
      <AdminQueryBoundary
        query={overview}
        loading={{
          title: "Loading dashboard",
          message: "Gathering the latest platform activity.",
        }}
        error={{
          title: "Dashboard unavailable",
          message: "The admin summary could not be loaded.",
        }}
      >
        <section aria-label="Platform metrics" className="admin-metric-grid">
          {overview.data?.metrics.map((metric) => (
            <article className="admin-metric-card" key={metric.id}>
              <span>{METRIC_LABEL[metric.id] || metric.id}</span>
              <strong>{formatMetric(metric.value)}</strong>
            </article>
          ))}
        </section>

        <div className="admin-overview-grid">
          <section className="admin-panel">
            <div className="admin-panel-heading">
              <div>
                <span className="admin-eyebrow">Communities</span>
                <h2>Operational snapshot</h2>
              </div>
              <span>{overview.data?.communities.length} tracked</span>
            </div>
            {overview.data?.communities.length ? (
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Community</th>
                      <th>Members</th>
                      <th>Open reports</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview.data.communities.map((community) => (
                      <tr key={community.id}>
                        <td>{community.name}</td>
                        <td>{formatMetric(community.members)}</td>
                        <td>{community.reports}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <AdminState
                kind="empty"
                title="No active communities"
                message="Communities will appear here once a game goes active."
              />
            )}
          </section>

          <section className="admin-panel">
            <div className="admin-panel-heading">
              <div>
                <span className="admin-eyebrow">Audit</span>
                <h2>Recent activity</h2>
              </div>
            </div>
            {overview.data?.activity.length ? (
              <ol className="admin-activity-list">
                {overview.data.activity.map((item) => (
                  <li key={item.id}>
                    <span aria-hidden="true" />
                    <div>
                      <b>{AUDIT_ACTION_LABEL[item.action] || item.action}</b>
                      <p>
                        {describeTarget(item)} &middot; by {item.actorName}
                      </p>
                    </div>
                    <time>{relativeTime(item.occurredAt)}</time>
                  </li>
                ))}
              </ol>
            ) : (
              <AdminState
                kind="empty"
                title="No recent activity"
                message="Moderation actions will show up here as they happen."
              />
            )}
          </section>
        </div>
      </AdminQueryBoundary>
    </AdminShell>
  );
}
