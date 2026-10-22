import { casePath } from "./moderation";

export type CaseView = "all" | "assigned" | "unassigned" | "history";
export type QueueFilters = {
  view: string;
  status: string;
  targetType: string;
  scope: string;
  gameSlug: string;
};

export const caseViews: Array<{ value: CaseView; label: string }> = [
  { value: "all", label: "Cases" },
  { value: "assigned", label: "Assigned to me" },
  { value: "unassigned", label: "Unassigned" },
  { value: "history", label: "Resolved / History" },
];
export function queueFilters(query: Record<string, unknown> = {}): QueueFilters {
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  return {
    view: caseViews.some((item) => item.value === query.view) ? text(query.view) : "all",
    status: ["OPEN", "IN_REVIEW", "RESOLVED", "DISMISSED"].includes(text(query.status))
      ? text(query.status)
      : "",
    targetType: ["POST", "COMMENT"].includes(text(query.targetType)) ? text(query.targetType) : "",
    scope: ["all", "platform", "game"].includes(text(query.scope)) ? text(query.scope) : "all",
    gameSlug: typeof query.gameSlug === "string" ? query.gameSlug.slice(0, 200) : "",
  };
}
export function queueUrl(gameSlug: string, filters: Partial<QueueFilters>, cursor?: string): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value && value !== "all" && !(gameSlug && ["scope", "gameSlug"].includes(key)))
      params.set(key, value);
  }
  if (cursor) params.set("cursor", cursor);
  return casePath(gameSlug) + (params.size ? `?${params}` : "");
}
// Queue context is query data only, never a caller-supplied redirect URL.
export function queueBackUrl(gameSlug: string, context: unknown): string {
  const params = new URLSearchParams(typeof context === "string" ? context.slice(0, 4096) : "");
  const filters = queueFilters(Object.fromEntries(params));
  const cursor = params.get("cursor");
  return queueUrl(
    gameSlug,
    filters,
    cursor && /^[A-Za-z0-9_-]{1,1024}$/.test(cursor) ? cursor : undefined,
  );
}
