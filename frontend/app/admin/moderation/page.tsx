"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { AdminShell } from "../../../components/admin/AdminShell";
import { AdminState } from "../../../components/admin/AdminState";
import { useRequireAdmin } from "../../../hooks/admin/useRequireAdmin";
import { queries } from "../../../lib/queries";

export default function AdminModerationPage() {
  const session = useRequireAdmin();
  const overview = useQuery({ ...queries.adminOverview(), enabled: session.isAdmin });
  if (session.isLoading || !session.isAdmin)
    return <AdminState kind="loading" title="Checking admin access" />;
  const all = [overview];
  const failed = all.find((query) => query.isError);
  return (
    <AdminShell user={session.user}>
      <div className="admin-page-heading">
        <div>
          <h1>Moderation center</h1>
          <p>Review cases and track complaint metrics.</p>
        </div>
      </div>
      {all.some((query) => query.isLoading) ? (
        <AdminState kind="loading" title="Loading moderation center" />
      ) : failed ? (
        <AdminState
          kind="error"
          title="Moderation data unavailable"
          message={failed.error?.message}
          onRetry={() => all.forEach((query) => query.refetch())}
        />
      ) : (
        <>
          <section className="admin-moderation-summary">
            <article>
              <div>
                <small>Open cases</small>
                <strong>{overview.data?.moderation?.openCases ?? 0}</strong>
                <p>Needs review or being reviewed.</p>
              </div>
              <Link className="admin-button admin-button-primary" href="/moderation/cases">
                Open case queue
              </Link>
            </article>
            <article>
              <div>
                <small>Open complaints</small>
                <strong>
                  {overview.data?.metrics.find((metric: { id: string; value?: number }) => metric.id === "reports")?.value ?? 0}
                </strong>
              </div>
            </article>
            <article>
              <div>
                <small>Unassigned cases</small>
                <strong>{overview.data?.moderation?.unassignedCases ?? 0}</strong>
              </div>
              <Link
                className="admin-button admin-button-secondary"
                href="/moderation/cases?view=unassigned"
              >
                Find unassigned work
              </Link>
            </article>
          </section>
          <p>
            Action taken or No violation records a decision. Content visibility is managed
            separately.
          </p>
        </>
      )}
    </AdminShell>
  );
}
