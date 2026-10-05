import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";
import { queries } from "./queries";
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe("community membership API", () => {
  it("uses session credentials and sends no user or role payload", async () => {
    const fetch = vi.fn(async (_url: string, _options: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => ({ joined: true, items: [] }),
    }));
    vi.stubGlobal("fetch", fetch);
    await api.joinGame("wuwa");
    await api.leaveGame("wuwa");
    await api.getGameJoinStatus("wuwa");
    await api.getJoinedGames();
    expect(fetch.mock.calls.map(([url]) => new URL(url).pathname)).toEqual([
      "/games/wuwa/join",
      "/games/wuwa/join",
      "/games/wuwa/join-status",
      "/games/joined",
    ]);
    for (const [, options] of fetch.mock.calls) {
      expect(options.credentials).toBe("include");
      expect(options.body).toBeUndefined();
    }
    expect(fetch.mock.calls[0]![1].method).toBe("POST");
    expect(fetch.mock.calls[1]![1].method).toBe("DELETE");
  });
  it("scopes status and joined-list caches by authenticated identity", () => {
    expect(queries.gameJoinStatus("wuwa", "a").queryKey).not.toEqual(
      queries.gameJoinStatus("wuwa", "b").queryKey,
    );
    expect(queries.joinedGames("a").queryKey).not.toEqual(queries.joinedGames("b").queryKey);
    expect(queries.gameJoinStatus("wuwa", undefined).enabled).toBe(false);
    expect(queries.joinedGames(undefined).enabled).toBe(false);
  });
});
