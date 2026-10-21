import { casePath } from "./moderation";

export const caseViews = [
  { value: "all", label: "Cases" },
  { value: "assigned", label: "Assigned to me" },
  { value: "unassigned", label: "Unassigned" },
  { value: "history", label: "Resolved / History" },
];
export function queueFilters(query = {}) {
  return {
    view: caseViews.some((item) => item.value === query.view) ? query.view : "all",
    status: ["OPEN", "IN_REVIEW", "RESOLVED", "DISMISSED"].includes(query.status)
      ? query.status
      : "",
    targetType: ["POST", "COMMENT"].includes(query.targetType) ? query.targetType : "",
    scope: ["all", "platform", "game"].includes(query.scope) ? query.scope : "all",
    gameSlug: typeof query.gameSlug === "string" ? query.gameSlug.slice(0, 200) : "",
  };
}
export function queueUrl(gameSlug, filters, cursor) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value && value !== "all" && !(gameSlug && ["scope", "gameSlug"].includes(key)))
      params.set(key, value);
  }
  if (cursor) params.set("cursor", cursor);
  return casePath(gameSlug) + (params.size ? `?${params}` : "");
}
// Queue context is query data only, never a caller-supplied redirect URL.
export function queueBackUrl(gameSlug, context) {
  const params = new URLSearchParams(typeof context === "string" ? context.slice(0, 4096) : "");
  const filters = queueFilters(Object.fromEntries(params));
  const cursor = params.get("cursor");
  return queueUrl(
    gameSlug,
    filters,
    cursor && /^[A-Za-z0-9_-]{1,1024}$/.test(cursor) ? cursor : undefined,
  );
}
