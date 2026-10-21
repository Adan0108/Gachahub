"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useModerationAccess } from "../../hooks/admin/useModerationAccess";
import {
  caseListOptions,
  casePath,
  caseStatusLabel,
  moderationError,
  moderationKeys,
  moderatorRoleLabel,
} from "../../lib/moderation";
import { CASE_STATUS_CLASS } from "../../lib/admin/statusTone";
import { ContentPreview, ReasonSummary } from "./CaseSummary";
import { AdminQueryBoundary } from "../admin/AdminQueryBoundary";
import { ModerationWorkspace } from "./ModerationWorkspace";
import { api } from "../../lib/api";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";

export function CaseQueue({ gameSlug = "" }) {
  const access = useModerationAccess(gameSlug);
  return (
    <ScopedCaseQueue
      key={`${access.user?.id || "guest"}:${gameSlug}`}
      access={access}
      gameSlug={gameSlug}
    />
  );
}

function ScopedCaseQueue({ access, gameSlug }) {
  const [filters, setFilters] = useState({
    status: "",
    targetType: "",
    scope: "all",
    gameSlug: "",
  });
  const [cursors, setCursors] = useState([undefined]);
  const cursor = cursors.at(-1);
  const queryFilters = gameSlug
    ? {
        status: filters.status,
        targetType: filters.targetType,
        cursor,
        limit: 20,
      }
    : {
        ...filters,
        gameSlug: filters.scope === "game" ? filters.gameSlug.trim() : undefined,
        limit: 20,
        cursor,
      };
  const valid = gameSlug || filters.scope !== "game" || filters.gameSlug.trim();
  const query = useQuery({
    ...caseListOptions(access.user?.id, gameSlug, queryFilters),
    enabled: access.allowed && Boolean(valid),
  });
  const update = (key, value) => {
    setFilters((current) => ({ ...current, [key]: value }));
    setCursors([undefined]);
  };
  const rows = query.data?.items || [];
  return (
    <ModerationWorkspace access={access} gameSlug={gameSlug}>
      <div className="admin-page-heading case-heading">
        <div>
          <span className="admin-eyebrow">Moderation</span>
          <h1>Cases</h1>
          <p>Review reported content and the complaints behind it.</p>
        </div>
      </div>
      <section className="admin-toolbar case-filters" aria-label="Case filters">
        <label>
          Status{" "}
          <select
            aria-label="Case status"
            value={filters.status}
            onChange={(event) => update("status", event.target.value)}
          >
            <option value="">All statuses</option>
            {["OPEN", "IN_REVIEW", "RESOLVED", "DISMISSED"].map((status) => (
              <option key={status} value={status}>
                {caseStatusLabel(status)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Content{" "}
          <select
            aria-label="Content type"
            value={filters.targetType}
            onChange={(event) => update("targetType", event.target.value)}
          >
            <option value="">All content</option>
            <option value="POST">Post</option>
            <option value="COMMENT">Comment</option>
          </select>
        </label>
        {!gameSlug && (
          <>
            <label>
              Location{" "}
              <select
                aria-label="Content location"
                value={filters.scope}
                onChange={(event) => update("scope", event.target.value)}
              >
                <option value="all">All locations</option>
                <option value="platform">Outside a community</option>
                <option value="game">Specific community</option>
              </select>
            </label>
            {filters.scope === "game" && (
              <CommunityFilter
                value={filters.gameSlug}
                onChange={(value) => update("gameSlug", value)}
                enabled={access.allowed}
                actorId={access.user?.id}
              />
            )}
          </>
        )}
      </section>
      {!valid ? (
        <p>Choose a community to see its cases.</p>
      ) : (
        <AdminQueryBoundary
          query={query}
          loading={{ title: "Loading cases" }}
          error={{ title: "Cases unavailable", message: moderationError(query.error) }}
          empty={!rows.length ? { title: "No cases found" } : null}
        >
          <div className="admin-table-wrap case-queue-panel">
            <table className="admin-table case-table">
              <thead>
                <tr>
                  <th scope="col">Content</th>
                  <th scope="col">Why reported</th>
                  <th scope="col">Reports</th>
                  <th scope="col">Status</th>
                  <th scope="col">Assigned</th>
                  <th scope="col">Last reported</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((item) => (
                  <tr key={item.id}>
                    <td data-label="Content">
                      <ContentPreview item={item} />
                    </td>
                    <td data-label="Why reported">
                      <ReasonSummary reasons={item.reasonSummary} compact />
                    </td>
                    <td data-label="Reports">
                      {item.reportCount} {item.reportCount === 1 ? "report" : "reports"}
                      <small>
                        {item.uniqueReporterCount}{" "}
                        {item.uniqueReporterCount === 1 ? "person" : "people"}
                      </small>
                    </td>
                    <td data-label="Status">
                      <span
                        className={`admin-status ${CASE_STATUS_CLASS[item.status] || ""}`}
                        data-status={item.status}
                      >
                        {caseStatusLabel(item.status)}
                      </span>
                    </td>
                    <td data-label="Assigned">
                      {item.assignedModerator?.name || "Unassigned"}
                      {item.assignedModerator && (
                        <small>{moderatorRoleLabel(item.assignedModerator, item.game)}</small>
                      )}
                      {item.currentRiskLevel && (
                        <small className="case-risk">
                          Risk: {item.currentRiskLevel.toLowerCase()}
                        </small>
                      )}
                    </td>
                    <td data-label="Last reported">
                      <time dateTime={item.lastReportedAt} title={formatDate(item.lastReportedAt)}>
                        {relativeDate(item.lastReportedAt)}
                      </time>
                    </td>
                    <td data-label="Action">
                      <Link href={casePath(gameSlug, item.id)}>View case</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </AdminQueryBoundary>
      )}
      {valid && query.data && !query.isError && (
        <nav className="case-pagination" aria-label="Case navigation">
          <button
            type="button"
            disabled={cursors.length === 1 || query.isFetching}
            onClick={() => setCursors((current) => current.slice(0, -1))}
          >
            Previous
          </button>
          <button
            type="button"
            disabled={!query.data.nextCursor || query.isFetching}
            onClick={() => setCursors((current) => [...current, query.data.nextCursor])}
          >
            Next
          </button>
        </nav>
      )}
    </ModerationWorkspace>
  );
}
function CommunityFilter({ value, onChange, enabled, actorId }) {
  const [search, setSearch] = useState("");
  const settledSearch = useDebouncedValue(search.trim(), 300);
  const communities = useQuery({
    queryKey: [...moderationKeys.account(actorId), "communities", settledSearch],
    queryFn: ({ signal }) => api.getGames({ search: settledSearch, limit: 20 }, { signal }),
    enabled,
    retry: false,
    gcTime: 0,
    staleTime: 30000,
  });
  return (
    <>
      <label>
        Find community
        <input
          aria-label="Find community"
          type="search"
          maxLength={100}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            onChange("");
          }}
          placeholder="Search by name"
        />
      </label>
      <label>
        Community
        <select
          aria-label="Community"
          value={value}
          disabled={communities.isLoading || communities.isError}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">
            {communities.isLoading ? "Finding communities..." : "Choose a community"}
          </option>
          {(communities.data?.items || []).map((game) => (
            <option key={game.id || game.slug} value={game.slug}>
              {game.name}
            </option>
          ))}
        </select>
      </label>
      {communities.isError && (
        <span className="case-filter-error" role="alert">
          Could not load communities.{" "}
          <button type="button" onClick={() => void communities.refetch()}>
            Try again
          </button>
        </span>
      )}
      {!communities.isLoading && !communities.isError && !communities.data?.items?.length && (
        <span className="case-muted">No matching communities. Try another name.</span>
      )}
      {(communities.data?.meta?.total || 0) > 20 && (
        <span className="case-muted">Showing 20 matches. Search by name to narrow the list.</span>
      )}
    </>
  );
}
export function formatDate(value) {
  return value && !Number.isNaN(Date.parse(value)) ? new Date(value).toLocaleString() : "—";
}
function relativeDate(value) {
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return "Unknown";
  const minutes = Math.max(0, Math.floor((Date.now() - date) / 60000));
  return minutes < 1
    ? "Just now"
    : minutes < 60
      ? `${minutes}m ago`
      : minutes < 1440
        ? `${Math.floor(minutes / 60)}h ago`
        : new Date(value).toLocaleDateString();
}
