import type { QueryCacheNotifyEvent, QueryClient } from "@tanstack/react-query";
import { api } from "./api";

type ModerationUser = { id?: string; role?: string | null; status?: string | null } | null | undefined;
type ApiFailure = { status?: number; message?: string } | null | undefined;
export type EvidencePage = { items?: unknown[]; nextCursor?: string | null };

export const MODERATION_ROOT = ["moderation"];
export const isPlatformModerator = (user: ModerationUser) =>
  user?.status === "ACTIVE" && ["ADMIN", "PLATFORM_MODERATOR"].includes(user.role ?? "");
const CASE_STATUS_LABELS: Record<string, string> = {
  OPEN: "Needs review",
  IN_REVIEW: "Being reviewed",
  RESOLVED: "Action taken",
  DISMISSED: "No violation",
};
export const caseStatusLabel = (status: string) => CASE_STATUS_LABELS[status] || status;
export const casePath = (gameSlug = "", caseId = "") =>
  `${gameSlug ? `/moderator/${encodeURIComponent(gameSlug)}/cases` : "/moderation/cases"}${caseId ? `/${encodeURIComponent(caseId)}` : ""}`;

const scopeKey = (actorId: string | undefined, gameSlug: string) => [
  ...MODERATION_ROOT,
  actorId,
  gameSlug ? "game" : "platform",
  gameSlug || null,
];
export const moderationKeys = {
  all: MODERATION_ROOT,
  account: (actorId: string | undefined) => [...MODERATION_ROOT, actorId],
  list: (actorId: string | undefined, gameSlug: string, filters: unknown) => [
    ...scopeKey(actorId, gameSlug),
    "list",
    "cursor",
    filters,
  ],
  detail: (actorId: string | undefined, gameSlug: string, caseId: string) => [
    ...scopeKey(actorId, gameSlug),
    "case",
    caseId,
  ],
  evidence: (actorId: string | undefined, gameSlug: string, caseId: string, limit = 20) => [
    ...moderationKeys.detail(actorId, gameSlug, caseId),
    "evidence",
    limit,
  ],
};

const sensitiveOptions = { retry: false, staleTime: 0, gcTime: 0, refetchOnWindowFocus: true };
export function caseListOptions(
  actorId: string | undefined,
  gameSlug = "",
  filters: Record<string, unknown> = {},
) {
  return {
    ...sensitiveOptions,
    queryKey: moderationKeys.list(actorId, gameSlug, filters),
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      gameSlug
        ? api.listGameCases(gameSlug, filters, { signal })
        : api.listPlatformCases(filters, { signal }),
    enabled: Boolean(actorId),
  };
}
export function caseDetailOptions(actorId: string | undefined, gameSlug: string, caseId: string) {
  return {
    ...sensitiveOptions,
    queryKey: moderationKeys.detail(actorId, gameSlug, caseId),
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      gameSlug
        ? api.getGameCase(gameSlug, caseId, { signal })
        : api.getPlatformCase(caseId, { signal }),
    enabled: Boolean(actorId && caseId),
  };
}
export function caseEvidenceOptions(
  actorId: string | undefined,
  gameSlug: string,
  caseId: string,
  firstPage: EvidencePage | null | undefined,
  limit = 20,
) {
  return {
    ...sensitiveOptions,
    // Only later pages live here; detail owns the first page and its initial cursor.
    queryKey: moderationKeys.evidence(actorId, gameSlug, caseId, limit),
    initialPageParam: firstPage?.nextCursor ?? null,
    queryFn: ({ pageParam, signal }: { pageParam: string | null; signal: AbortSignal }) =>
      gameSlug
        ? api.listGameCaseReports(gameSlug, caseId, { cursor: pageParam, limit }, { signal })
        : api.listPlatformCaseReports(caseId, { cursor: pageParam, limit }, { signal }),
    getNextPageParam: (lastPage: EvidencePage) => lastPage.nextCursor ?? undefined,
    enabled: false,
  };
}
export async function refreshModeration(client: QueryClient, actorId: string | undefined) {
  await Promise.all([
    client.invalidateQueries({ queryKey: moderationKeys.account(actorId) }),
    client.invalidateQueries({ queryKey: ["admin", "overview"] }),
  ]);
}
export async function clearModerationCache(client: QueryClient) {
  const cancellation = client.cancelQueries({ queryKey: MODERATION_ROOT });
  client.removeQueries({ queryKey: MODERATION_ROOT });
  await cancellation;
}
// Observe the live session, including role/status changes, before cached evidence can be reused.
export function watchModerationSession(client: QueryClient) {
  let previous: string | undefined;
  return client.getQueryCache().subscribe((event: QueryCacheNotifyEvent) => {
    if (
      event.query.queryKey[0] !== "current-user" ||
      event.type !== "updated" ||
      event.action?.type !== "success"
    )
      return;
    const user = event.query.state.data as ModerationUser;
    const identity = `${user?.id || ""}:${user?.role || ""}:${user?.status || ""}`;
    if (identity !== previous) {
      previous = identity;
      void clearModerationCache(client);
    }
  });
}
const MODERATION_ERRORS: Record<number, string> = {
  400: "The request could not be accepted. Check the filters or note.",
  401: "Your session has ended. Please sign in again.",
  403: "You no longer have access to this moderation workspace.",
  404: "This case or game is unavailable in this workspace.",
  409: "This case changed while you were reviewing it. The latest state has been requested.",
};
export const moderationError = (error: unknown) => {
  const failure = error as ApiFailure;
  return !failure?.status || failure.status >= 500
    ? "Something went wrong. Please try again."
    : MODERATION_ERRORS[failure.status] || failure.message || "Could not load moderation data.";
};

export const moderatorRoleLabel = (
  user: { role?: string | null } | null | undefined,
  game: { name?: string | null } | null | undefined,
) =>
  user?.role === "ADMIN"
    ? "Admin"
    : user?.role === "PLATFORM_MODERATOR"
      ? "Platform moderator"
      : game?.name
        ? `${game.name} moderator`
        : "Moderator";
