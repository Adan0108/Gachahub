"use client";

import { useState } from "react";
import Link from "next/link";
import { queueBackUrl, queueFilters } from "../../lib/moderation-queue";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { useModerationAccess } from "../../hooks/admin/useModerationAccess";
import {
  caseDetailOptions,
  caseEvidenceOptions,
  caseStatusLabel,
  moderationError,
  refreshModeration,
  moderatorRoleLabel,
} from "../../lib/moderation";
import { AdminActionDialog } from "../admin/AdminActionDialog";
import { AdminQueryBoundary } from "../admin/AdminQueryBoundary";
import { ModerationWorkspace } from "./ModerationWorkspace";
import { formatDate } from "./CaseQueue";
import { CASE_STATUS_CLASS } from "../../lib/admin/statusTone";
import Image from "next/image";
import { ReasonSummary, reasonLabel } from "./CaseSummary";
import { ModeratorPicker } from "./ModeratorPicker";
import { AvatarFace } from "../AvatarFace";

export function CaseDetail({ caseId, gameSlug = "", queue = "" }) {
  const access = useModerationAccess(gameSlug);
  const query = useQuery({
    ...caseDetailOptions(access.user?.id, gameSlug, caseId),
    enabled: access.allowed && Boolean(caseId),
  });
  return (
    <ModerationWorkspace
      access={access}
      gameSlug={gameSlug}
      view={
        queueFilters(
          Object.fromEntries(new URLSearchParams(typeof queue === "string" ? queue : "")),
        ).view
      }
    >
      <Link className="case-back-link" href={queueBackUrl(gameSlug, queue)}>
        ← Back to cases
      </Link>
      <AdminQueryBoundary
        query={query}
        loading={{ title: "Loading case" }}
        error={{ title: "Case unavailable", message: moderationError(query.error) }}
      >
        {query.data && !query.isError && (
          <CaseRecord
            key={`${access.user?.id}:${gameSlug}:${caseId}`}
            item={query.data}
            gameSlug={gameSlug}
            actorId={access.user?.id}
          />
        )}
      </AdminQueryBoundary>
    </ModerationWorkspace>
  );
}

function CaseRecord({ item, gameSlug, actorId }) {
  const client = useQueryClient();
  const [decision, setDecision] = useState(null);
  const [note, setNote] = useState("");
  const [notice, setNotice] = useState("");
  const [denied, setDenied] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const mutation = useMutation({
    mutationFn: ({ action, resolutionNote, assigneeId }) => {
      if (action === "assign")
        return gameSlug
          ? api.assignGameCase(gameSlug, item.id, { assigneeId })
          : api.assignPlatformCase(item.id, { assigneeId });
      const names = gameSlug
        ? { claim: "claimGameCase", resolve: "resolveGameCase", dismiss: "dismissGameCase" }
        : {
            claim: "claimPlatformCase",
            resolve: "resolvePlatformCase",
            dismiss: "dismissPlatformCase",
          };
      const args = gameSlug ? [gameSlug, item.id] : [item.id];
      return api[names[action]](...args, { resolutionNote });
    },
    onSuccess: async (_, variables) => {
      setDecision(null);
      setAssigning(false);
      setNote("");
      setNotice(
        variables.action === "claim"
          ? "Assigned to you."
          : variables.action === "assign"
            ? "Case assignment updated."
            : `Case ${variables.action === "resolve" ? "resolved" : "dismissed"}.`,
      );
      await refreshModeration(client, actorId);
    },
    onError: async (error, variables) => {
      setNotice(
        variables.action === "assign" && error.status === 400
          ? "That moderator is no longer eligible. Search again and choose another moderator."
          : moderationError(error),
      );
      if ([401, 403, 404].includes(error.status)) {
        setDenied(true);
        setDecision(null);
      }
      if ([401, 403, 404, 409].includes(error.status)) {
        setDecision(null);
        await refreshModeration(client, actorId);
        await client.invalidateQueries({ queryKey: ["current-user"] });
      }
    },
  });
  const active = !denied && ["OPEN", "IN_REVIEW"].includes(item.status);
  return (
    <>
      <div className="admin-page-heading case-heading">
        <div>
          <span className="admin-eyebrow">Case review</span>
          <h1>
            {item.targetState === "deleted"
              ? "Content deleted"
              : item.target?.title ||
                (item.target
                  ? item.targetType === "COMMENT"
                    ? "Reported comment"
                    : "Reported post"
                  : "Content unavailable")}
          </h1>
          <p>
            {caseStatusLabel(item.status)} · {item.game?.name || "Outside a community"} ·{" "}
            {item.reportCount} {item.reportCount === 1 ? "report" : "reports"} from{" "}
            {item.uniqueReporterCount} {item.uniqueReporterCount === 1 ? "person" : "people"}
          </p>
        </div>
      </div>
      {notice && (
        <p className="case-notice" role="status">
          {notice}
        </p>
      )}
      {denied ? (
        <p role="alert">Access to this case is no longer available.</p>
      ) : (
        <>
          <div className="case-detail-grid">
            <div className="case-reading">
              <section className="admin-panel case-content">
                <div className="case-section-heading">
                  <div>
                    <h2>Reported content</h2>
                  </div>
                  <span className="case-context-chip">
                    {item.targetType === "COMMENT" ? "Comment" : "Post"}
                  </span>
                </div>
                <p
                  className={`case-target-state case-target-state-${item.targetState || "missing"}`}
                >
                  {item.targetState === "available"
                    ? "Content available"
                    : item.targetState === "deleted"
                      ? "Content deleted"
                      : "Content unavailable"}
                </p>
                {item.target ? (
                  <TargetContent target={item.target} />
                ) : (
                  <p>You can still review what users reported below.</p>
                )}
              </section>
              <section className="admin-panel case-content" aria-labelledby="case-reasons-title">
                <h2 id="case-reasons-title">Why users reported this</h2>
                <ReasonSummary reasons={item.reasonSummary} />
              </section>
              <CaseEvidence
                key={`${item.id}:${item.evidence?.nextCursor || "end"}`}
                actorId={actorId}
                gameSlug={gameSlug}
                item={item}
                onDenied={() => {
                  setDenied(true);
                  void refreshModeration(client, actorId);
                  void client.invalidateQueries({ queryKey: ["current-user"] });
                }}
              />
            </div>
            <aside className="case-workflow" aria-labelledby="case-workflow-title">
              <div className="case-section-heading">
                <div>
                  <h2 id="case-workflow-title">Review status</h2>
                </div>
                <span className={`admin-status ${CASE_STATUS_CLASS[item.status] || ""}`}>
                  {caseStatusLabel(item.status)}
                </span>
              </div>
              <dl className="case-facts">
                <dt>Reports received</dt>
                <dd>{item.reportCount}</dd>
                <dt>Reported by</dt>
                <dd>
                  {item.uniqueReporterCount} {item.uniqueReporterCount === 1 ? "person" : "people"}
                </dd>
                <dt>Assigned to</dt>
                <dd>
                  {item.assignedModerator?.name || "Unassigned"}
                  {item.assignedModerator && (
                    <small className="case-role-badge">
                      {moderatorRoleLabel(item.assignedModerator, item.game)}
                    </small>
                  )}
                </dd>
                {(item.currentRiskLevel || item.currentRiskScore != null) && (
                  <>
                    <dt>Risk</dt>
                    <dd>
                      {item.currentRiskLevel?.toLowerCase()}
                      {item.currentRiskScore != null && ` (${item.currentRiskScore})`}
                    </dd>
                  </>
                )}
              </dl>
              <h3>Decision</h3>
              <dl className="case-facts">
                <dt>Created</dt>
                <dd>{formatDate(item.createdAt)}</dd>
                <dt>Last updated</dt>
                <dd>{formatDate(item.updatedAt)}</dd>
                <dt>Resolved by</dt>
                <dd>{item.resolvedBy?.name || "—"}</dd>
                <dt>Resolved at</dt>
                <dd>{formatDate(item.resolvedAt)}</dd>
                <dt>Decision note</dt>
                <dd>{item.resolutionNote || (active ? "No decision yet" : "No note added")}</dd>
              </dl>
              <TechnicalDetails item={item} />
              {active && (
                <section className="case-actions" aria-label="Case actions">
                  {item.status === "OPEN" && (
                    <button
                      disabled={mutation.isPending}
                      onClick={() => mutation.mutate({ action: "claim" })}
                      className="case-button case-button-primary"
                      type="button"
                    >
                      Assign to me
                    </button>
                  )}
                  <button
                    type="button"
                    className="case-button case-button-secondary"
                    disabled={mutation.isPending}
                    onClick={() => {
                      setAssigning((value) => !value);
                      mutation.reset();
                    }}
                  >
                    {assigning ? "Cancel assignment" : "Assign another moderator"}
                  </button>
                  {assigning && (
                    <ModeratorPicker
                      actorId={actorId}
                      scopeKey={`${gameSlug}:${item.id}`}
                      game={item.game}
                      search={(q, options) =>
                        gameSlug
                          ? api.searchGameCaseAssignees(gameSlug, item.id, q, options)
                          : api.searchPlatformCaseAssignees(item.id, q, options)
                      }
                      onSelect={(user) =>
                        mutation.mutate({ action: "assign", assigneeId: user.id })
                      }
                      disabled={mutation.isPending}
                    />
                  )}
                  {["resolve", "dismiss"].map((action) => (
                    <button
                      key={action}
                      className={`case-button ${action === "dismiss" ? "case-button-danger" : "case-button-secondary"}`}
                      disabled={mutation.isPending}
                      onClick={() => {
                        mutation.reset();
                        setDecision(action);
                        setNote("");
                      }}
                      type="button"
                    >
                      {action === "resolve" ? "Resolve" : "Dismiss"}
                    </button>
                  ))}
                  <p>
                    These decisions close the review. Content stays visible unless removed
                    separately.
                  </p>
                </section>
              )}

              {!active && (
                <p className="case-readonly">
                  Review complete. You can still read the user reports.
                </p>
              )}
            </aside>
          </div>
        </>
      )}
      {decision && active && (
        <AdminActionDialog
          className="case-action-modal"
          title={`${decision === "resolve" ? "Resolve" : "Dismiss"} case`}
          description="Save your decision and close this review. Content will remain visible unless removed separately."
          confirmLabel={decision === "resolve" ? "Resolve case" : "Dismiss case"}
          pendingLabel="Saving…"
          pending={mutation.isPending}
          error={mutation.error ? moderationError(mutation.error) : undefined}
          tone="primary"
          onClose={() => setDecision(null)}
          onConfirm={() => mutation.mutate({ action: decision, resolutionNote: note.trim() })}
        >
          <label>
            Decision note (optional)
            <textarea
              aria-label="Decision note"
              rows={3}
              maxLength={1000}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
        </AdminActionDialog>
      )}
    </>
  );
}

function CaseEvidence({ actorId, gameSlug, item, onDenied }) {
  const first = item.evidence || { items: [], nextCursor: null };
  const more = useInfiniteQuery(caseEvidenceOptions(actorId, gameSlug, item.id, first));
  const [unavailable, setUnavailable] = useState(false);
  const rows = [
    ...(first.items || []),
    ...(more.data?.pages || []).flatMap((page) => page.items || []),
  ].filter((row, index, all) => all.findIndex((other) => other.id === row.id) === index);
  const hasMore = more.data ? more.hasNextPage : Boolean(first.nextCursor);
  return (
    <section className="admin-panel case-evidence">
      <div className="case-section-heading">
        <div>
          <h2>User reports</h2>
        </div>
        <span className="case-context-chip">{rows.length} shown</span>
      </div>
      <p>A reported snapshot shows the content as it looked when the report was sent.</p>
      {unavailable ? (
        <p role="alert">You no longer have access to these reports.</p>
      ) : (
        <>
          {!rows.length && <p>No user reports available.</p>}
          {rows.map((report) => (
            <article className="case-evidence-item" key={report.id}>
              <h3>{reasonLabel(report.reasonCode)}</h3>
              <p className="case-reporter">
                <span className="case-person-avatar" aria-hidden="true">
                  <AvatarFace
                    name={report.reporter?.name || "Deleted user"}
                    image={report.reporter?.image}
                  />
                </span>
                <span>
                  Reported by {report.reporter?.name || "Deleted user"} ·{" "}
                  <time dateTime={report.createdAt}>{formatDate(report.createdAt)}</time>
                </span>
              </p>
              {report.details && <p className="case-text">{report.details}</p>}
              <details className="case-snapshot">
                <summary>View reported snapshot</summary>
                {report.snapshot?.version === 1 && typeof report.snapshot.content === "string" ? (
                  <TargetContent target={report.snapshot} />
                ) : (
                  <p>No reported snapshot available.</p>
                )}
              </details>
            </article>
          ))}
          {more.isError && <p role="alert">{moderationError(more.error)}</p>}
          {hasMore && (
            <button
              className="case-button case-button-secondary"
              disabled={more.isFetching}
              onClick={async () => {
                const result = await more.fetchNextPage();
                if ([401, 403, 404].includes(result.error?.status)) {
                  setUnavailable(true);
                  onDenied?.();
                }
              }}
              type="button"
            >
              {more.isFetching
                ? "Loading reports…"
                : more.isError
                  ? "Try loading reports again"
                  : "Load more reports"}
            </button>
          )}
        </>
      )}
    </section>
  );
}

function TechnicalDetails({ item }) {
  const [notice, setNotice] = useState("");
  const identifiers = [
    ["Case ID", item.id],
    ["Content ID", item.targetId],
    ["Post ID", item.target?.postId],
  ].filter(([, value]) => value);
  const copy = async (label, value) => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(value);
      setNotice(`${label} copied.`);
    } catch {
      setNotice("Copy unavailable. Select the value to copy it.");
    }
  };
  return (
    <details className="case-technical">
      <summary>Technical details</summary>
      <dl className="case-facts">
        {identifiers.map(([label, value]) => (
          <div className="case-identifier" key={label}>
            <dt>{label}</dt>
            <dd>
              <code>{value}</code>
              <button
                type="button"
                aria-label={`Copy ${label.toLowerCase()}`}
                onClick={() => void copy(label, value)}
              >
                Copy
              </button>
            </dd>
          </div>
        ))}
      </dl>
      <p role="status">{notice}</p>
    </details>
  );
}

function TargetContent({ target }) {
  return (
    <div className="case-target">
      <p>
        {target.targetType === "COMMENT" ? "Comment" : "Post"}
        {target.author?.name && ` by ${target.author.name}`}
      </p>
      {target.title && <h3>{target.title}</h3>}
      <p className="case-text">{target.content || "No text content."}</p>
      {(Array.isArray(target.media) ? target.media : []).map((media, index) => (
        <MediaPreview key={index} media={media} />
      ))}
    </div>
  );
}
function MediaPreview({ media }) {
  // Never render arbitrary HTML or non-web URLs from evidence.
  if (typeof media?.url !== "string" || !/^https?:\/\//i.test(media.url)) return null;
  return (
    <a href={media.url} target="_blank" rel="noopener noreferrer">
      {media.mediaType === "IMAGE" && (
        <Image
          unoptimized
          src={media.url}
          width={240}
          height={160}
          alt={media.altText || "Reported image"}
        />
      )}
      <span>{media.altText || "View attachment"}</span>
    </a>
  );
}
