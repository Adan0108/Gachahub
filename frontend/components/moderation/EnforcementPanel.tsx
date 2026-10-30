"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { moderationKeys, refreshModeration, moderationError } from "../../lib/moderation";
import {
  sanctionLabels,
  sanctionEffects,
  type EnforcementOverview,
  type SanctionKind,
} from "../../lib/enforcement";
import { AdminActionDialog } from "../admin/AdminActionDialog";
import { formatDate } from "./CaseQueue";
import { reasonLabel } from "./CaseSummary";

type Decision = { kind: "violation" | "sanction" | "revoke" | "reverse" | "adjust"; id?: string };
export function EnforcementPanel({
  caseId,
  actorId,
  gameSlug = "",
}: {
  caseId: string;
  actorId?: string;
  gameSlug?: string;
}) {
  const query = useQuery({
    queryKey: [...moderationKeys.detail(actorId, gameSlug, caseId), "enforcement"],
    queryFn: ({ signal }) => api.getCaseEnforcement(caseId, gameSlug, { signal }),
    enabled: Boolean(actorId && caseId),
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: true,
  });
  const [decision, setDecision] = useState<Decision | null>(null);
  if (query.isLoading)
    return (
      <section
        className="admin-panel case-ai-panel"
        aria-label="Author moderation history"
        aria-busy="true"
      >
        <h2>Author moderation history</h2>
        <p>Loading decisions and restrictions…</p>
      </section>
    );
  if (query.isError || !query.data)
    return (
      <section className="admin-panel case-ai-panel">
        <h2>Author moderation history</h2>
        <p role="status">Decision support unavailable.</p>
        <button
          className="case-button case-button-secondary"
          type="button"
          onClick={() => void query.refetch()}
        >
          Retry decision support
        </button>
      </section>
    );
  const data = query.data;
  return (
    <>
      <section className="admin-panel case-ai-panel" aria-labelledby="author-history-title">
        <div className="case-section-heading">
          <div>
            <h2 id="author-history-title">{data.subject.name}&apos;s moderation history</h2>
            <p className="case-muted">
              {data.scope === "COMMUNITY" ? "This community only" : "Platform-wide history"} · Human
              decisions
            </p>
          </div>
          <span
            className={`case-ai-status case-ai-risk-${data.risk.tier === "ELEVATED" ? "medium" : data.risk.tier.toLowerCase()}`}
          >
            {data.risk.tier[0]}
            {data.risk.tier.slice(1).toLowerCase()} user risk
          </span>
        </div>
        <dl className="enforcement-stats">
          {[
            ["Reports received", data.counts.reports],
            ["Distinct cases", data.counts.cases],
            ["Pending reviews", data.counts.pending],
            ["Dismissed reports", data.counts.dismissedReports],
            ["Confirmed violations", data.counts.confirmedViolations],
            ["Reversed findings", data.counts.reversedFindings],
            ["Warnings", data.counts.warnings ?? 0],
            ["Previous suspensions", data.counts.previousSuspensions ?? 0],
            ["Active restrictions", data.counts.activeSanctions ?? 0],
          ].map(([label, count]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{count}</dd>
            </div>
          ))}
        </dl>
        <p className="case-ai-guidance">
          Reports are allegations, not confirmed violations. AI findings do not establish a
          violation or automatically restrict an account.
        </p>
        <p>{data.risk.explanation}</p>
        <details className="case-ai-details">
          <summary>How user risk is calculated</summary>
          <p>
            Showing up to 50 recent factors. The score includes all effective confirmed incidents.
            Expired restrictions: {data.counts.expiredSanctions ?? 0}. Revoked restrictions:{" "}
            {data.counts.revokedSanctions ?? 0}. Successful appeals:{" "}
            {data.counts.successfulAppeals ?? 0}.
          </p>
          <p>
            Internal review indicator: <strong>{data.risk.score} / 100</strong>. This is not a
            probability or prediction. Independent confirmed incidents contribute according to
            severity and recency. Repeat incidents receive a capped increase; warnings and
            suspensions for the same incident add no extra points.
          </p>
          <p>
            Contributions halve over 120 days for minor, 240 for moderate, 365 for severe and 540
            for critical findings by default. The current policy factors below show any configured
            values.
          </p>
          <ul>
            {data.risk.factors.map((factor) => (
              <li key={factor.violationId}>
                {factor.severity.toLowerCase()} incident · {factor.elapsedDays} days ago ·{" "}
                {factor.contribution.toFixed(2)} remaining weight · half-life {factor.halfLifeDays}{" "}
                days
              </li>
            ))}
          </ul>
          <p>
            Calculated{" "}
            <time dateTime={data.risk.evaluatedAt}>{formatDate(data.risk.evaluatedAt)}</time>.
          </p>
        </details>
        {data.permissions.canSanction && (
          <div className="case-actions enforcement-controls">
            {data.permissions.canConfirm && (
              <button
                className="case-button case-button-secondary"
                type="button"
                onClick={() => setDecision({ kind: "violation" })}
              >
                Record confirmed violation
              </button>
            )}
            <button
              className="case-button case-button-primary"
              type="button"
              onClick={() => setDecision({ kind: "sanction" })}
            >
              Warn or restrict account
            </button>
          </div>
        )}
        <h3>Recorded violations</h3>
        {!data.violations.length && (
          <p className="case-muted">No confirmed violations recorded in this scope.</p>
        )}
        <ul className="enforcement-records">
          {data.violations.map((record) => (
            <li key={record.id}>
              <strong>
                {reasonLabel(record.category)} · {record.severity.toLowerCase()}
                {record.reversedAt ? " · Reversed" : ""}
              </strong>
              <p className="case-text">{record.reason}</p>
              <time dateTime={record.createdAt}>{formatDate(record.createdAt)}</time>
              {!record.reversedAt && data.permissions.canSanction && (
                <button
                  className="case-button case-button-secondary"
                  type="button"
                  onClick={() => setDecision({ kind: "reverse", id: record.id })}
                >
                  Reverse finding
                </button>
              )}
            </li>
          ))}
        </ul>
        <h3>Restrictions and warnings</h3>
        <p className="case-muted">
          Latest 50 decisions. Expired and revoked decisions remain in history.
        </p>
        {!data.sanctions.length && <p>No restrictions or warnings in this scope.</p>}
        <ul className="enforcement-records">
          {data.sanctions.map((record) => (
            <li key={record.id}>
              <strong>
                {sanctionLabels[record.type]} · {record.effectiveStatus.toLowerCase()}
              </strong>
              <p className="case-text">{record.reason}</p>
              <p>
                {record.expiresAt
                  ? `Ends ${formatDate(record.expiresAt)}`
                  : "Informational warning; no access restriction"}
              </p>
              {data.permissions.canSanction && record.status !== "REVOKED" && (
                <div className="case-actions">
                  <button
                    className="case-button case-button-secondary"
                    type="button"
                    onClick={() => setDecision({ kind: "revoke", id: record.id })}
                  >
                    Revoke restriction
                  </button>
                  {record.expiresAt && record.effectiveStatus === "ACTIVE" && (
                    <button
                      className="case-button case-button-secondary"
                      type="button"
                      onClick={() => setDecision({ kind: "adjust", id: record.id })}
                    >
                      Adjust duration
                    </button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
        <details className="case-ai-details">
          <summary>Content enforcement and decision history</summary>
          <ul className="enforcement-records">
            {data.contentHistory.map((record) => (
              <li key={record.id}>
                <strong>
                  {record.scope === "PLATFORM" ? "Platform" : "Community"} content restriction ·{" "}
                  {record.revokedAt ? "Reversed" : "Active"}
                </strong>
                <p className="case-text">{record.reason}</p>
                <time dateTime={record.createdAt}>{formatDate(record.createdAt)}</time>
              </li>
            ))}
          </ul>
          <ol className="enforcement-records">
            {data.history.map((record) => (
              <li key={record.id}>
                <strong>{record.action.toLowerCase().replaceAll("_", " ")}</strong>
                <p className="case-text">{record.reason}</p>
                <small>
                  {record.actor?.name || "System"} · {formatDate(record.createdAt)}
                </small>
              </li>
            ))}
          </ol>
          {!data.history.length && <p>No enforcement decisions recorded yet.</p>}
        </details>
      </section>
      {decision && (
        <EnforcementDecision
          key={`${decision.kind}:${decision.id || "new"}`}
          decision={decision}
          data={data}
          caseId={caseId}
          actorId={actorId}
          gameSlug={gameSlug}
          close={() => setDecision(null)}
        />
      )}
    </>
  );
}

function EnforcementDecision({
  decision,
  data,
  caseId,
  actorId,
  gameSlug,
  close,
}: {
  decision: Decision;
  data: EnforcementOverview;
  caseId: string;
  actorId?: string;
  gameSlug: string;
  close: () => void;
}) {
  const client = useQueryClient();
  const [reason, setReason] = useState("");
  const [category, setCategory] = useState("HARASSMENT");
  const [severity, setSeverity] = useState("MINOR");
  const [type, setType] = useState<SanctionKind>("WARNING");
  const durationDays = (data.permissions.durationDays || [1, 3, 7, 30]).filter((day) =>
    [1, 3, 7, 30].includes(day),
  );
  const allowedTypes = data.permissions.sanctionTypes.filter((kind) =>
    Object.hasOwn(sanctionLabels, kind),
  );
  const [days, setDays] = useState(String(durationDays[0] || 1));
  const [customDuration, setCustomDuration] = useState(false);
  const [violationId, setViolationId] = useState("");
  const [enforcementId, setEnforcementId] = useState("");
  const [requestKey] = useState(() => crypto.randomUUID());
  const titles = {
    violation: "Record a confirmed violation",
    sanction: "Warn or restrict account",
    revoke: "Revoke this restriction?",
    reverse: "Reverse this violation?",
    adjust: "Adjust restriction duration",
  };
  const descriptions = {
    violation:
      "Record a human finding supported by the evidence. This affects user risk but does not hide content, issue a sanction or resolve the case.",
    sanction:
      "Choose the least restrictive appropriate action. The person will receive a notice and can appeal. This does not resolve the case or confirm a violation.",
    revoke:
      "The restriction will stop applying. Its history remains available. A linked violation remains effective unless separately reversed.",
    reverse:
      "This finding will stop contributing to user risk. All sanctions attached to it will be revoked. The audit trail is preserved.",
    adjust:
      "The total duration is measured from the original start and cannot exceed 30 days. Expired restrictions require a new explicit decision. This adjustment remains in the audit history.",
  };
  const timed = decision.kind === "adjust" || (decision.kind === "sanction" && type !== "WARNING");
  const mutation = useMutation({
    mutationFn: async () => {
      const note = reason.trim();
      if (decision.kind === "violation")
        return api.confirmCaseViolation(caseId, { category, severity, reason: note }, gameSlug);
      if (decision.kind === "revoke") return api.revokeSanction(decision.id!, note, gameSlug);
      if (decision.kind === "reverse") return api.reverseViolation(decision.id!, note, gameSlug);
      if (decision.kind === "adjust")
        return api.adjustSanction(decision.id!, Number(days), note, gameSlug);
      return api.issueCaseSanction(
        caseId,
        {
          type,
          reason: note,
          requestKey,
          ...(timed ? { durationDays: Number(days) } : {}),
          ...(violationId ? { violationId } : {}),
          ...(enforcementId ? { enforcementId } : {}),
        },
        gameSlug,
      );
    },
    onSuccess: async () => {
      close();
      await refreshModeration(client, actorId);
      await client.invalidateQueries({ queryKey: ["my-moderation"] });
    },
  });
  return (
    <AdminActionDialog
      title={titles[decision.kind]}
      description={descriptions[decision.kind]}
      confirmLabel="Record decision"
      pendingLabel="Recording…"
      pending={mutation.isPending}
      tone="primary"
      confirmDisabled={
        reason.trim().length < 3 ||
        (timed && (!Number.isInteger(Number(days)) || Number(days) < 1 || Number(days) > 30)) ||
        (decision.kind === "sanction" && !allowedTypes.includes(type))
      }
      error={mutation.error ? moderationError(mutation.error) : undefined}
      onClose={close}
      onConfirm={() => mutation.mutate()}
    >
      {decision.kind === "violation" && (
        <>
          <label>
            Policy category
            <select
              aria-label="Policy category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {[
                "HARASSMENT",
                "HATE",
                "VIOLENCE",
                "COMMERCIAL_SPAM",
                "SCAM",
                "IMPERSONATION",
                "MISINFORMATION",
                "NSFW",
                "UNMARKED_SPOILERS",
                "OTHER",
              ].map((code) => (
                <option key={code} value={code}>
                  {reasonLabel(code)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Violation severity
            <select
              aria-label="Violation severity"
              value={severity}
              onChange={(e) => setSeverity(e.target.value)}
            >
              {["MINOR", "MODERATE", "SEVERE", "CRITICAL"].map((value) => (
                <option key={value} value={value}>
                  {value.toLowerCase()}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
      {decision.kind === "sanction" && (
        <>
          <p role="status">{sanctionEffects[type]}</p>
          <label>
            Restriction type
            <select
              aria-label="Restriction type"
              value={type}
              onChange={(e) => setType(e.target.value as SanctionKind)}
            >
              {allowedTypes.map((kind) => (
                <option key={kind} value={kind}>
                  {sanctionLabels[kind]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Related confirmed violation (optional)
            <select
              aria-label="Related confirmed violation (optional)"
              value={violationId}
              onChange={(e) => setViolationId(e.target.value)}
            >
              <option value="">No finding linked</option>
              {data.violations
                .filter((v) => v.caseId === caseId && v.scope === data.scope && !v.reversedAt)
                .map((v) => (
                  <option key={v.id} value={v.id}>
                    {reasonLabel(v.category)} · {v.severity.toLowerCase()}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Related content restriction (optional)
            <select
              aria-label="Related content restriction (optional)"
              value={enforcementId}
              onChange={(e) => setEnforcementId(e.target.value)}
            >
              <option value="">No content restriction linked</option>
              {data.contentHistory
                .filter((v) => !v.revokedAt)
                .map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.reason}
                  </option>
                ))}
            </select>
          </label>
        </>
      )}
      {timed && (
        <label>
          {decision.kind === "adjust" ? "Total duration from original start" : "Duration from now"}
          <select
            aria-label={
              decision.kind === "adjust"
                ? "Total duration from original start"
                : "Duration from now"
            }
            value={customDuration ? "custom" : days}
            onChange={(e) => {
              setCustomDuration(e.target.value === "custom");
              setDays(e.target.value === "custom" ? "" : e.target.value);
            }}
          >
            {durationDays.map((day) => (
              <option key={day} value={day}>
                {day} {day === 1 ? "day" : "days"}
              </option>
            ))}
            {data.permissions.customDuration && <option value="custom">Custom duration</option>}
          </select>
          {data.permissions.customDuration && customDuration && (
            <input
              aria-label="Custom duration in days"
              type="number"
              min={1}
              max={30}
              value={days}
              onChange={(e) => setDays(e.target.value)}
            />
          )}
        </label>
      )}
      <label>
        Reason
        <textarea
          aria-label="Decision reason"
          maxLength={1000}
          minLength={3}
          required
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Explain the evidence and why this action is appropriate."
        />
      </label>
    </AdminActionDialog>
  );
}
