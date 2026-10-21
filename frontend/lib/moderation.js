import { api } from "./api";

export const MODERATION_ROOT = ["moderation"];
export const isPlatformModerator = (user) =>
  user?.status === "ACTIVE" && ["ADMIN", "PLATFORM_MODERATOR"].includes(user.role);
export const caseStatusLabel = (status) =>
  ({
    OPEN: "Needs review",
    IN_REVIEW: "Being reviewed",
    RESOLVED: "Resolved",
    DISMISSED: "Dismissed",
  })[status] || status;
export const casePath = (gameSlug = "", caseId = "") =>
  `${gameSlug ? `/moderator/${encodeURIComponent(gameSlug)}/cases` : "/moderation/cases"}${caseId ? `/${encodeURIComponent(caseId)}` : ""}`;

const scopeKey = (actorId, gameSlug) => [
  ...MODERATION_ROOT,
  actorId,
  gameSlug ? "game" : "platform",
  gameSlug || null,
];
export const moderationKeys = {
  all: MODERATION_ROOT,
  account: (actorId) => [...MODERATION_ROOT, actorId],
  list: (actorId, gameSlug, filters) => [...scopeKey(actorId, gameSlug), "list", "cursor", filters],
  detail: (actorId, gameSlug, caseId) => [...scopeKey(actorId, gameSlug), "case", caseId],
  evidence: (actorId, gameSlug, caseId, limit = 20) => [
    ...moderationKeys.detail(actorId, gameSlug, caseId),
    "evidence",
    limit,
  ],
};

const sensitiveOptions = { retry: false, staleTime: 0, gcTime: 0, refetchOnWindowFocus: true };
export function caseListOptions(actorId, gameSlug = "", filters = {}) {
  return {
    ...sensitiveOptions,
    queryKey: moderationKeys.list(actorId, gameSlug, filters),
    queryFn: ({ signal }) =>
      gameSlug
        ? api.listGameCases(gameSlug, filters, { signal })
        : api.listPlatformCases(filters, { signal }),
    enabled: Boolean(actorId),
  };
}
export function caseDetailOptions(actorId, gameSlug, caseId) {
  return {
    ...sensitiveOptions,
    queryKey: moderationKeys.detail(actorId, gameSlug, caseId),
    queryFn: ({ signal }) =>
      gameSlug
        ? api.getGameCase(gameSlug, caseId, { signal })
        : api.getPlatformCase(caseId, { signal }),
    enabled: Boolean(actorId && caseId),
  };
}
export function caseEvidenceOptions(actorId, gameSlug, caseId, firstPage, limit = 20) {
  return {
    ...sensitiveOptions,
    // Only later pages live here; detail owns the first page and its initial cursor.
    queryKey: moderationKeys.evidence(actorId, gameSlug, caseId, limit),
    initialPageParam: firstPage?.nextCursor ?? null,
    queryFn: ({ pageParam, signal }) =>
      gameSlug
        ? api.listGameCaseReports(gameSlug, caseId, { cursor: pageParam, limit }, { signal })
        : api.listPlatformCaseReports(caseId, { cursor: pageParam, limit }, { signal }),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: false,
  };
}
export async function refreshModeration(client, actorId) {
  await Promise.all([
    client.invalidateQueries({ queryKey: moderationKeys.account(actorId) }),
    client.invalidateQueries({ queryKey: ["admin", "overview"] }),
  ]);
}
export async function clearModerationCache(client) {
  const cancellation = client.cancelQueries({ queryKey: MODERATION_ROOT });
  client.removeQueries({ queryKey: MODERATION_ROOT });
  await cancellation;
}
// Observe the live session, including role/status changes, before cached evidence can be reused.
export function watchModerationSession(client) {
  let previous;
  return client.getQueryCache().subscribe((event) => {
    if (
      event.query.queryKey[0] !== "current-user" ||
      event.type !== "updated" ||
      event.action?.type !== "success"
    )
      return;
    const user = event.query.state.data;
    const identity = `${user?.id || ""}:${user?.role || ""}:${user?.status || ""}`;
    if (identity !== previous) {
      previous = identity;
      void clearModerationCache(client);
    }
  });
}
export const moderationError = (error) =>
  ({
    400: "The request could not be accepted. Check the filters or note.",
    401: "Your session has ended. Please sign in again.",
    403: "You no longer have access to this moderation workspace.",
    404: "This case or game is unavailable in this workspace.",
    409: "This case changed while you were reviewing it. The latest state has been requested.",
  })[error?.status] ||
  error?.message ||
  "Could not load moderation data.";

export const moderatorRoleLabel = (user, game) =>
  user?.role === "ADMIN" ? "Admin" : user?.role === "PLATFORM_MODERATOR"
    ? "Platform moderator" : game?.name ? `${game.name} moderator` : "Moderator";
