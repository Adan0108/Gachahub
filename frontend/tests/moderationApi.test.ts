import { beforeEach, expect, it, vi } from "vitest";
import { api } from "../lib/api";

beforeEach(() =>
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({ items: [], id: "case" }) }),
  ),
);
it.each([
  [
    "listPlatformCases",
    [{ status: "OPEN", scope: "game", gameSlug: "a/b", cursor: "next", limit: 20 }],
    "/moderation/cases?cursor=next&limit=20&status=OPEN&scope=game&gameSlug=a%2Fb",
    "GET",
  ],
  ["getPlatformCase", ["c/a"], "/moderation/cases/c%2Fa", "GET"],
  [
    "listPlatformCaseReports",
    ["c/a", { cursor: "a+/=", limit: 20 }],
    "/moderation/cases/c%2Fa/reports?cursor=a%2B%2F%3D&limit=20",
    "GET",
  ],
  ["claimPlatformCase", ["c/a"], "/moderation/cases/c%2Fa/claim", "PATCH"],
  [
    "resolvePlatformCase",
    ["c/a", { resolutionNote: "Reviewed" }],
    "/moderation/cases/c%2Fa/resolve",
    "PATCH",
  ],
  [
    "dismissPlatformCase",
    ["c/a", { resolutionNote: "Reviewed" }],
    "/moderation/cases/c%2Fa/dismiss",
    "PATCH",
  ],
  [
    "listGameCases",
    ["g/a", { targetType: "COMMENT", status: "IN_REVIEW" }],
    "/games/g%2Fa/moderation/cases?status=IN_REVIEW&targetType=COMMENT",
    "GET",
  ],
  ["getGameCase", ["g/a", "c/a"], "/games/g%2Fa/moderation/cases/c%2Fa", "GET"],
  [
    "listGameCaseReports",
    ["g/a", "c/a", { cursor: "next", limit: 10 }],
    "/games/g%2Fa/moderation/cases/c%2Fa/reports?cursor=next&limit=10",
    "GET",
  ],
  ["claimGameCase", ["g/a", "c/a"], "/games/g%2Fa/moderation/cases/c%2Fa/claim", "PATCH"],
  [
    "resolveGameCase",
    ["g/a", "c/a", { resolutionNote: "Reviewed" }],
    "/games/g%2Fa/moderation/cases/c%2Fa/resolve",
    "PATCH",
  ],
  [
    "dismissGameCase",
    ["g/a", "c/a", { resolutionNote: "Reviewed" }],
    "/games/g%2Fa/moderation/cases/c%2Fa/dismiss",
    "PATCH",
  ],
])("%s uses native encoded case routes", async (method, args, path, verb) => {
  await (api as any)[method](...args);
  expect(fetch).toHaveBeenCalledWith(
    expect.stringContaining(path),
    expect.objectContaining({
      credentials: "include",
      ...(verb === "PATCH" ? { method: verb } : {}),
    }),
  );
  if (method.startsWith("resolve") || method.startsWith("dismiss"))
    expect(JSON.parse((fetch as any).mock.calls[0][1].body)).toEqual({ resolutionNote: "Reviewed" });
});
it.each([400, 403, 404, 409])("preserves HTTP %s for moderation handling", async (status) => {
  (fetch as any).mockResolvedValue({ ok: false, status, json: async () => ({ message: "Rejected" }) });
  await expect(api.claimPlatformCase("case")).rejects.toMatchObject({
    status,
    message: "Rejected",
  });
});
it("keeps user complaint submission independent from case workflow", async () => {
  await api.createReport({ targetType: "POST", targetId: "post", reasonCode: "OTHER" });
  expect(fetch).toHaveBeenCalledWith(
    expect.stringMatching(/\/reports$/),
    expect.objectContaining({ method: "POST" }),
  );
});

it.each([
  ["listPlatformCases", []], ["listGameCases", ["game"]],
  ["listPlatformCaseReports", ["case"]], ["listGameCaseReports", ["game", "case"]],
])("%s sends only cursor pagination parameters", async (method, prefix) => {
  await (api as any)[method](...prefix, { cursor: "boundary", limit: 7, page: 2, pagination: "page", totalPages: 9 });
  const url = new URL((fetch as any).mock.calls[0][0]);
  expect(Object.fromEntries(url.searchParams)).toEqual({ cursor: "boundary", limit: "7" });
});
