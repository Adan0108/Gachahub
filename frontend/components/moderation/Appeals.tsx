"use client";
import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { useCurrentUser } from "../../hooks/useCurrentUser";
import { useModerationAccess } from "../../hooks/admin/useModerationAccess";
import { moderationKeys, moderationError, refreshModeration } from "../../lib/moderation";
import { sanctionLabels, sanctionEffects, type AppealPage } from "../../lib/enforcement";
import { AdminActionDialog } from "../admin/AdminActionDialog";
import { AdminQueryBoundary } from "../admin/AdminQueryBoundary";
import { ModerationWorkspace } from "./ModerationWorkspace";
import { formatDate } from "./CaseQueue";

export function MyModeration() {
  const session = useCurrentUser();
  if (session.isError) return (
    <main className="page moderation-workspace">
      <h1>Account unavailable</h1>
      <p>We could not check your session. Try again to view notices and appeals.</p>
      <button type="button" className="case-button" onClick={() => { void session.refetch(); }}>Try again</button>
    </main>
  );
  return (
    <MyModerationAccount
      key={session.user?.id || "guest"}
      userId={session.user?.id}
      loading={session.isLoading}
    />
  );
}
function MyModerationAccount({ userId, loading }: { userId?: string; loading: boolean }) {
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined]);
  const [contentCursors, setContentCursors] = useState<Array<string | undefined>>([undefined]);
  const [appealing, setAppealing] = useState<string | null>(null);
  const [statement, setStatement] = useState("");
  const client = useQueryClient();
  const query = useQuery({
    queryKey: [
      ...moderationKeys.account(userId),
      "own-sanctions",
      cursors.at(-1),
      contentCursors.at(-1),
    ],
    queryFn: ({ signal }) => api.getMyModeration(cursors.at(-1), { signal }, contentCursors.at(-1)),
    enabled: Boolean(userId),
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: true,
  });
  const mutation = useMutation({
    mutationFn: () => api.submitModerationAppeal(appealing!, statement.trim()),
    onSuccess: async () => {
      setAppealing(null);
      setStatement("");
      await refreshModeration(client, userId);
    },
  });
  if (!userId && !loading)
    return (
      <main className="page moderation-workspace">
        <h1>Your moderation notices</h1>
        <p>Sign in to view decisions about your account and submit an appeal.</p>
        <Link href="/login">Sign in</Link>
      </main>
    );
  return (
    <main className="page moderation-workspace user-moderation-page">
      <Link className="case-back-link" href="/">
        Back to GachaHub
      </Link>
      <div className="admin-page-heading">
        <div>
          <span className="admin-eyebrow">Your account</span>
          <h1>Your moderation notices</h1>
          <p>Understand a decision, check when a restriction ends, or request another review.</p>
        </div>
      </div>
      <p className="case-ai-guidance">
        You can access this page and appeal while your account is restricted. An appeal is reviewed
        by another moderator. Submitting one does not extend or pause a restriction.
      </p>
      <AdminQueryBoundary
        isLoading={loading || query.isLoading}
        isError={query.isError}
        onRetry={() => query.refetch()}
        loading={{ title: "Loading your notices" }}
        error={{ title: "Notices unavailable", message: moderationError(query.error) }}
        empty={
          query.data && !query.data.items.length && !query.data.contentNotices?.length
            ? {
                title: "No moderation notices",
                message: "There are no warnings or restrictions to show.",
              }
            : null
        }
      >
        <ul className="enforcement-records">
          {query.data?.items.map((record) => (
            <li className="admin-panel case-ai-panel" key={record.id}>
              <div className="case-section-heading">
                <h2>{sanctionLabels[record.type]}</h2>
                <span className="case-ai-status">{record.effectiveStatus.toLowerCase()}</span>
              </div>
              <p>{record.game ? record.game.name : "Across GachaHub"}</p>
              <p className="case-text">
                <strong>Reason: </strong>
                {record.reason}
              </p>
              <p>{record.effectiveStatus === "ACTIVE" ? sanctionEffects[record.type] : "This decision no longer restricts your account. Its history remains available."}</p>
              <dl className="enforcement-stats">
                <div>
                  <dt>Started</dt>
                  <dd>{formatDate(record.startsAt)}</dd>
                </div>
                <div>
                  <dt>Ends</dt>
                  <dd>
                    {record.expiresAt
                      ? formatDate(record.expiresAt)
                      : record.type === "WARNING"
                        ? "Not a timed restriction"
                        : "No scheduled end"}
                  </dd>
                </div>
              </dl>
              {record.appeal ? (
                <div className="case-ai-guidance">
                  <strong>Appeal {record.appeal.status.toLowerCase()}</strong>
                  <p className="case-text">{record.appeal.statement}</p>
                  {record.appeal.decisionReason && (
                    <p className="case-text">Decision: {record.appeal.decisionReason}</p>
                  )}
                </div>
              ) : (
                record.status !== "REVOKED" && (
                  <button
                    className="case-button case-button-secondary"
                    type="button"
                    onClick={() => {
                      mutation.reset();
                      setStatement("");
                      setAppealing(record.id);
                    }}
                  >
                    Appeal this decision
                  </button>
                )
              )}
            </li>
          ))}
        </ul>
      </AdminQueryBoundary>
      <nav className="case-pagination" aria-label="Notice pages">
        <button
          type="button"
          disabled={cursors.length === 1 || query.isFetching}
          onClick={() => setCursors((c) => c.slice(0, -1))}
        >
          Previous
        </button>
        <button
          type="button"
          disabled={!query.data?.nextCursor || query.isFetching}
          onClick={() => setCursors((c) => [...c, query.data!.nextCursor!])}
        >
          Next
        </button>
      </nav>
      {!!query.data?.contentNotices?.length && (
        <section aria-label="Content decisions">
          <h2>Content decisions</h2>
          <ul className="enforcement-records">
            {query.data.contentNotices.map((notice) => (
              <li className="admin-panel case-ai-panel" key={notice.id}>
                <h3>
                  {notice.targetType === "POST" ? "Post" : "Comment"} restriction ·{" "}
                  {notice.revokedAt ? "Reversed" : "Active"}
                </h3>
                <p>{notice.game?.name || "Across GachaHub"}</p>
                <p className="case-text">{notice.reason}</p>
                <p>
                  Recorded {formatDate(notice.createdAt)}
                  {notice.revokedAt ? ` · Reversed ${formatDate(notice.revokedAt)}` : ""}
                </p>
              </li>
            ))}
          </ul>
          <nav className="case-pagination" aria-label="Content decision pages">
            <button
              type="button"
              disabled={contentCursors.length === 1 || query.isFetching}
              onClick={() => setContentCursors((c) => c.slice(0, -1))}
            >
              Previous content decisions
            </button>
            <button
              type="button"
              disabled={!query.data?.contentNextCursor || query.isFetching}
              onClick={() => setContentCursors((c) => [...c, query.data!.contentNextCursor!])}
            >
              Next content decisions
            </button>
          </nav>
        </section>
      )}
      {appealing && (
        <AdminActionDialog
          title="Appeal this decision"
          description="Explain what you believe was misunderstood and include relevant context. Reporter identities are kept private."
          confirmLabel="Submit appeal"
          pendingLabel="Submitting…"
          tone="primary"
          pending={mutation.isPending}
          confirmDisabled={statement.trim().length < 10}
          error={mutation.error ? moderationError(mutation.error) : undefined}
          onClose={() => setAppealing(null)}
          onConfirm={() => mutation.mutate()}
        >
          <label>
            Your explanation
            <textarea
              aria-label="Appeal explanation"
              required
              minLength={10}
              maxLength={2000}
              value={statement}
              onChange={(e) => setStatement(e.target.value)}
            />
          </label>
        </AdminActionDialog>
      )}
    </main>
  );
}

export function AppealsQueue({ gameSlug = "" }: { gameSlug?: string }) {
  const access = useModerationAccess(gameSlug);
  return (
    <ScopedAppealsQueue
      key={`${access.user?.id || "guest"}:${gameSlug}`}
      gameSlug={gameSlug}
      access={access}
    />
  );
}
function ScopedAppealsQueue({
  gameSlug,
  access,
}: {
  gameSlug: string;
  access: ReturnType<typeof useModerationAccess>;
}) {
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined]);
  const [reviewing, setReviewing] = useState<AppealPage["items"][number] | null>(null);
  const query = useQuery({
    queryKey: [...moderationKeys.account(access.user?.id), "appeals", gameSlug, cursors.at(-1)],
    queryFn: ({ signal }) => api.listModerationAppeals(gameSlug, cursors.at(-1), { signal }),
    enabled: access.allowed,
    retry: false,
    gcTime: 0,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
  return (
    <ModerationWorkspace access={access} gameSlug={gameSlug}>
      <div className="admin-page-heading">
        <div>
          <span className="admin-eyebrow">Independent review</span>
          <h1>Moderation appeals</h1>
          <p>
            Reconsider the decision and its consequences. Your own enforcement actions require
            another reviewer.
          </p>
        </div>
      </div>
      <AdminQueryBoundary
        query={query}
        loading={{ title: "Loading appeals" }}
        error={{ title: "Appeals unavailable", message: moderationError(query.error) }}
        empty={query.data && !query.data.items.length ? { title: "No appeals to show" } : null}
      >
        <ul className="enforcement-records">
          {query.data?.items.map((appeal) => (
            <li className="admin-panel case-ai-panel" key={appeal.id}>
              <div className="case-section-heading">
                <h2>{sanctionLabels[appeal.sanction.type]}</h2>
                <span className="case-ai-status">{appeal.status.toLowerCase()}</span>
              </div>
              <p className="case-text">
                <strong>Original reason: </strong>
                {appeal.sanction.reason}
              </p>
              <p className="case-text">
                <strong>Appeal: </strong>
                {appeal.statement}
              </p>
              <p>Submitted {formatDate(appeal.createdAt)}</p>
              {appeal.sanction.caseId && (
                <Link
                  className="case-back-link"
                  href={`${gameSlug ? `/moderator/${encodeURIComponent(gameSlug)}` : "/moderation"}/cases/${encodeURIComponent(appeal.sanction.caseId)}`}
                >
                  Review case evidence
                </Link>
              )}
              {appeal.status === "PENDING" && appeal.canReview && (
                <button
                  className="case-button case-button-primary"
                  type="button"
                  onClick={() => setReviewing(appeal)}
                >
                  Review appeal
                </button>
              )}
              {appeal.status === "PENDING" && !appeal.canReview && (
                <p className="case-muted">
                  Another authorized moderator must review this decision.
                </p>
              )}
              {appeal.decisionReason && (
                <p className="case-text">Decision: {appeal.decisionReason}</p>
              )}
            </li>
          ))}
        </ul>
      </AdminQueryBoundary>
      <nav className="case-pagination" aria-label="Appeal pages">
        <button
          type="button"
          disabled={cursors.length === 1 || query.isFetching}
          onClick={() => setCursors((c) => c.slice(0, -1))}
        >
          Previous
        </button>
        <button
          type="button"
          disabled={!query.data?.nextCursor || query.isFetching}
          onClick={() => setCursors((c) => [...c, query.data!.nextCursor!])}
        >
          Next
        </button>
      </nav>
      {reviewing && (
        <ReviewAppeal
          key={reviewing.id}
          appeal={reviewing}
          actorId={access.user?.id}
          gameSlug={gameSlug}
          close={() => setReviewing(null)}
        />
      )}
    </ModerationWorkspace>
  );
}
function ReviewAppeal({
  appeal,
  actorId,
  gameSlug,
  close,
}: {
  appeal: AppealPage["items"][number];
  actorId?: string;
  gameSlug: string;
  close: () => void;
}) {
  const [decision, setDecision] = useState("REJECTED");
  const [reason, setReason] = useState("");
  const [reverse, setReverse] = useState(false);
  const [restore, setRestore] = useState(false);
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: () =>
      api.reviewModerationAppeal(
        appeal.id,
        {
          decision,
          reason: reason.trim(),
          ...(decision === "ACCEPTED"
            ? { reverseViolation: reverse, restoreContent: restore }
            : {}),
        },
        gameSlug,
      ),
    onSuccess: async () => {
      close();
      await refreshModeration(client, actorId);
    },
  });
  return (
    <AdminActionDialog
      title="Decide this appeal"
      description="Accepting revokes this sanction. Choose separately whether its linked finding and content restriction should be reversed. Other independent restrictions remain effective."
      confirmLabel="Record appeal decision"
      pendingLabel="Recording…"
      pending={mutation.isPending}
      tone="primary"
      confirmDisabled={reason.trim().length < 3}
      error={mutation.error ? moderationError(mutation.error) : undefined}
      onClose={close}
      onConfirm={() => mutation.mutate()}
    >
      <label>
        Decision
        <select
          aria-label="Decision"
          value={decision}
          onChange={(e) => setDecision(e.target.value)}
        >
          <option value="REJECTED">Uphold original decision</option>
          <option value="ACCEPTED">Accept appeal and revoke sanction</option>
        </select>
      </label>
      {decision === "ACCEPTED" && (
        <>
          {appeal.sanction.violationId && (
            <label className="enforcement-checkbox">
              <input
                type="checkbox"
                checked={reverse}
                onChange={(e) => setReverse(e.target.checked)}
              />
              Reverse the linked violation and its sanctions
            </label>
          )}
          {appeal.sanction.enforcementId && (
            <label className="enforcement-checkbox">
              <input
                type="checkbox"
                checked={restore}
                onChange={(e) => setRestore(e.target.checked)}
              />
              Reverse the linked content restriction if eligible
            </label>
          )}
        </>
      )}
      <label>
        Decision explanation
        <textarea
          aria-label="Appeal decision reason"
          maxLength={1000}
          minLength={3}
          required
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
    </AdminActionDialog>
  );
}
