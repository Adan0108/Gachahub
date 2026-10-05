import { afterEach, describe, expect, it, vi } from "vitest";
import { InfiniteQueryObserver, QueryClient } from "@tanstack/react-query";
import { api } from "./api";
import { queries } from "./queries";
import { cursorFeedOptions } from "./cursorFeed";

const cursor = "opaque+/=unchanged";
const page = (id: string, hasMore = true) => ({
  items: [{ id }],
  meta: { limit: 20, hasMore, nextCursor: hasMore ? cursor : null },
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("feed API cursor contract", () => {
  it.each(["latest", "trending", "for-you", "game"])(
    "%s omits page and returns opaque cursors unchanged",
    async (kind) => {
      const fetch = vi.fn(async (_url: string) => ({
        ok: true,
        status: 200,
        json: async () => page("post"),
      }));
      vi.stubGlobal("fetch", fetch);
      const call = (query: object) =>
        kind === "game"
          ? api.getGameFeed("wuwa", query)
          : kind === "latest"
            ? api.getLatestFeed(query)
            : kind === "trending"
              ? api.getTrendingFeed(query)
              : api.getForYouFeed(query);
      const first = await call({ page: 1, limit: 20 });
      await call({ cursor, limit: 20 });
      expect([
        ...new URL(fetch.mock.calls[0]![0] as unknown as string).searchParams.keys(),
      ]).toEqual(["limit"]);
      expect(new URL(fetch.mock.calls[1]![0] as unknown as string).searchParams.get("cursor")).toBe(
        cursor,
      );
      expect(first.meta).toEqual(page("post").meta);
      expect(first.meta).not.toHaveProperty("total");
      expect(first.meta).not.toHaveProperty("totalPages");
    },
  );

  it("home requests Latest and Trending without page", async () => {
    vi.spyOn(api, "getGames").mockResolvedValue({ items: [], meta: {} });
    const latest = vi.spyOn(api, "getLatestFeed").mockResolvedValue(page("latest"));
    const trending = vi.spyOn(api, "getTrendingFeed").mockResolvedValue(page("trending"));
    await api.getHome();
    expect(latest).toHaveBeenCalledWith({ limit: 10 });
    expect(trending).toHaveBeenCalledWith({ limit: 10 });
  });
});

describe("feed infinite query", () => {
  it("appends opaque continuation and ends at hasMore=false", async () => {
    const client = new QueryClient();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(page("one"))
      .mockResolvedValueOnce(page("two", false));
    const options = cursorFeedOptions(["test-feed"], fetch);
    const observer = new InfiniteQueryObserver(client, options);
    const unsubscribe = observer.subscribe(() => {});
    await observer.refetch();
    await observer.fetchNextPage();
    expect(fetch.mock.calls[0]![0].cursor).toBeUndefined();
    expect(fetch.mock.calls[1]![0].cursor).toBe(cursor);
    expect(observer.getCurrentResult().data?.pages.flatMap((p) => p.items)).toEqual([
      { id: "one" },
      { id: "two" },
    ]);
    expect(observer.getCurrentResult().hasNextPage).toBe(false);
    await observer.fetchNextPage();
    expect(fetch).toHaveBeenCalledTimes(2);
    unsubscribe();
    client.clear();
  });

  it("filter scopes include sort, type, game, category and user", () => {
    const base = queries.gameFeed("a", "guides", { userId: "u1" });
    for (const changed of [
      queries.gameFeed("b", "guides", { userId: "u1" }),
      queries.gameFeed("a", "lore", { userId: "u1" }),
      queries.gameFeed("a", "guides", { userId: "u2" }),
      queries.gameFeed("a", "guides", { userId: "u1", sort: "trending" }),
      queries.gameFeed("a", "guides", { userId: "u1", type: "GUIDE" }),
    ])
      expect(changed.queryKey).not.toEqual(base.queryKey);
    expect(base.initialPageParam).toBeUndefined();
    expect(queries.feed("for-you").enabled).toBe(false);
    expect(queries.feed("for-you", { type: "GUIDE" }, "u1").queryKey).not.toEqual(
      queries.feed("for-you", { type: "GUIDE" }, "u2").queryKey,
    );
  });

  it("never retries backend invalid or expired cursor responses", () => {
    const options = queries.feed("trending");
    expect(options.retry(0, { status: 400 })).toBe(false);
    expect(options.retry(0, { status: 410 })).toBe(false);
  });
});
