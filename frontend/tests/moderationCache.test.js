import { QueryClient } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import {
  moderationKeys,
  clearModerationCache,
  watchModerationSession,
  refreshModeration,
  caseEvidenceOptions,
} from "../lib/moderation";
import { api } from "../lib/api";

it("separates actor, endpoint scope, game, filters, case and evidence size", () => {
  const keys = [
    moderationKeys.list("a", "", {}),
    moderationKeys.list("b", "", {}),
    moderationKeys.list("a", "g", {}),
    moderationKeys.list("a", "h", {}),
    moderationKeys.list("a", "g", { cursor: "older", limit: 20 }),
    moderationKeys.list("a", "g", { cursor: "newer", limit: 20 }),
    moderationKeys.list("a", "g", { cursor: "older", limit: 50 }),
    moderationKeys.list("a", "g", { status: "OPEN", limit: 20 }),
    moderationKeys.detail("a", "g", "c"),
    moderationKeys.detail("a", "g", "d"),
    moderationKeys.evidence("a", "g", "c", 20),
    moderationKeys.evidence("a", "g", "c", 10),
  ];
  expect(new Set(keys.map(JSON.stringify)).size).toBe(keys.length);
});
it("invalidates platform/game lists, details and overview after actions", async () => {
  const client = new QueryClient();
  const keys = [
    moderationKeys.list("a", "", {}),
    moderationKeys.list("a", "g", {}),
    moderationKeys.detail("a", "g", "c"),
    ["admin", "overview"],
  ];
  keys.forEach((key) => client.setQueryData(key, {}));
  await refreshModeration(client, "a");
  keys.forEach((key) => expect(client.getQueryState(key).isInvalidated).toBe(true));
});
it("removes sensitive queries on sign-out while preserving public data", async () => {
  const client = new QueryClient();
  client.setQueryData(moderationKeys.detail("a", "", "c"), { secret: true });
  client.setQueryData(["games"], []);
  await clearModerationCache(client);
  expect(client.getQueriesData({ queryKey: ["moderation"] })).toEqual([]);
  expect(client.getQueryData(["games"])).toEqual([]);
});
it("purges cached evidence on account switches, role revocation and logout", async () => {
  const client = new QueryClient();
  const stop = watchModerationSession(client);
  for (const user of [
    { id: "a", role: "ADMIN", status: "ACTIVE" },
    { id: "b", role: "PLATFORM_MODERATOR", status: "ACTIVE" },
    { id: "b", role: "USER", status: "ACTIVE" },
    null,
  ]) {
    client.setQueryData(moderationKeys.detail("a", "", "c"), { secret: true });
    client.setQueryData(["current-user"], user);
    await Promise.resolve();
    await Promise.resolve();
    expect(client.getQueryData(moderationKeys.detail("a", "", "c"))).toBeUndefined();
  }
  stop();
});
it("starts evidence after detail's opaque boundary without fetching page one", async () => {
  const spy = vi
    .spyOn(api, "listPlatformCaseReports")
    .mockResolvedValue({ items: [], nextCursor: null });
  const options = caseEvidenceOptions("a", "", "c", { items: [{ id: "r" }], nextCursor: "opaque" });
  expect(options.enabled).toBe(false);
  expect(options.initialPageParam).toBe("opaque");
  await options.queryFn({ pageParam: options.initialPageParam });
  expect(spy).toHaveBeenCalledWith("c", { cursor: "opaque", limit: 20 }, { signal: undefined });
  expect(options.getNextPageParam({ nextCursor: null })).toBeUndefined();
});
