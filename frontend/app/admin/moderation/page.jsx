"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { AdminShell } from "../../../components/admin/AdminShell";
import { AdminState } from "../../../components/admin/AdminState";
import { useRequireAdmin } from "../../../hooks/admin/useRequireAdmin";
import { queries } from "../../../lib/queries";

export default function AdminModerationPage() {
  const session = useRequireAdmin();
  const content = useQuery({
    ...queries.adminContent("", 1, { excludeHidden: true, limit: 100 }),
    enabled: session.isAdmin,
  });
  const overview = useQuery({ ...queries.adminOverview(), enabled: session.isAdmin });
  if (session.isLoading || !session.isAdmin)
    return <AdminState kind="loading" title="Checking admin access" />;
  const all = [content, overview];
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
                <small>Moderation cases</small>
                <strong>Review cases</strong>
                <p>Review reported content and record decisions in the case queue.</p>
              </div>
              <Link href="/moderation/cases">Open case queue</Link>
            </article>
            <article>
              <div>
                <small>Open complaints</small>
                <strong>
                  {overview.data?.metrics.find((metric) => metric.id === "reports")?.value ?? 0}
                </strong>
              </div>
            </article>
            <article>
              <div>
                <small>Flagged content</small>
                <strong>{content.data?.meta?.total ?? content.data?.items?.length ?? 0}</strong>
              </div>
              <Link href="/admin/content">Review content</Link>
            </article>
          </section>
          <p>
            Resolving or dismissing a case records a decision. Content visibility is managed
            separately.
          </p>
        </>
      )}
    </AdminShell>
  );
}
