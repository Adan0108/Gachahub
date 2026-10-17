/** Remove a deleted post from regular lists, home sections and infinite-query pages. */
export function removePostFromCache(data: unknown, postId: string): unknown {
  if (Array.isArray(data)) {
    return data
      .filter((item) => !isPost(item, postId))
      .map((item) => removePostFromCache(item, postId));
  }
  if (!data || typeof data !== "object") return data;
  const record = data as Record<string, unknown>;
  const removed = Array.isArray(record.items) && record.items.some((item) => isPost(item, postId));
  const result = Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key, removePostFromCache(value, postId)]),
  );
  if (removed && record.meta && typeof record.meta === "object") {
    const meta = record.meta as Record<string, unknown>;
    if (typeof meta.total === "number")
      result.meta = { ...meta, total: Math.max(0, meta.total - 1) };
  }
  return result;
}

function isPost(item: unknown, postId: string) {
  return Boolean(item && typeof item === "object" && "id" in item && item.id === postId);
}
