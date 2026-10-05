import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api } from "../lib/api";
import { queries } from "../lib/queries";
import { useCursorFeed } from "../hooks/useCursorFeed";

const cursor = "opaque+/=unchanged";
const page = (id, hasMore = true) => ({
  items: [{ id }],
  meta: { limit: 20, hasMore, nextCursor: hasMore ? cursor : null },
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function setup(options) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(({ options }) => useCursorFeed(options), {
    wrapper,
    initialProps: { options },
  });
}

describe("cursor feed API", () => {
  it.each([
    ["getLatestFeed", "/feed/latest"],
    ["getTrendingFeed", "/feed/trending"],
    ["getForYouFeed", "/feed/for-you"],
    ["getGameFeed", "/games/wuthering-waves/feed"],
  ])("%s sends only cursor pagination and preserves metadata", async (method, path) => {
    const body = page("post");
    const fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => body }));
    vi.stubGlobal("fetch", fetch);
    const call = (params) =>
      method === "getGameFeed" ? api[method]("wuthering-waves", params) : api[method](params);
    const initial = await call({
      page: 1,
      total: 99,
      totalPages: 5,
      candidateCount: 99,
      limit: 20,
    });
    await call({
      limit: 20,
      cursor,
      ...(method === "getGameFeed"
        ? { sort: "trending", categorySlug: "guides", type: "GUIDE" }
        : {}),
    });
    const first = new URL(fetch.mock.calls[0][0]);
    const next = new URL(fetch.mock.calls[1][0]);
    expect(first.pathname).toBe(path);
    expect([...first.searchParams.keys()]).toEqual(["limit"]);
    expect(next.searchParams.get("cursor")).toBe(cursor);
    expect(initial.meta).toEqual(body.meta);
    expect(initial.meta).not.toHaveProperty("total");
    expect(initial.meta).not.toHaveProperty("totalPages");
    if (method === "getGameFeed") expect(next.searchParams.get("sort")).toBe("trending");
  });

  it("home aggregator omits page for both Latest and Trending", async () => {
    const latest = vi.spyOn(api, "getLatestFeed").mockResolvedValue(page("latest"));
    const trending = vi.spyOn(api, "getTrendingFeed").mockResolvedValue(page("trending"));
    vi.spyOn(api, "getGames").mockResolvedValue({ items: [], meta: {} });
    const data = await api.getHome();
    expect(latest).toHaveBeenCalledWith({ limit: 10 });
    expect(trending).toHaveBeenCalledWith({ limit: 10 });
    expect(data.latestMeta.nextCursor).toBe(cursor);
    expect(data.trendingMeta.nextCursor).toBe(cursor);
  });
});

describe("cursor feed state", () => {
  it.each(["latest", "trending", "for-you"])(
    "%s appends once, forwards the cursor and stops at hasMore=false",
    async (sort) => {
      const method =
        sort === "for-you"
          ? "getForYouFeed"
          : sort === "trending"
            ? "getTrendingFeed"
            : "getLatestFeed";
      let resolveNext;
      const fetch = vi
        .spyOn(api, method)
        .mockResolvedValueOnce(page("first"))
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveNext = resolve;
            }),
        );
      const hook = setup(queries.feed(sort, { type: "GUIDE" }, "user-1"));
      await waitFor(() => expect(hook.result.current.items).toHaveLength(1));
      expect(fetch.mock.calls[0][0].cursor).toBeUndefined();
      let pending;
      await act(async () => {
        pending = hook.result.current.loadMore();
        void hook.result.current.loadMore();
      });
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(fetch.mock.calls[1][0].cursor).toBe(cursor);
      await act(async () => {
        resolveNext(page("second", false));
        await pending;
      });
      await waitFor(() =>
        expect(hook.result.current.items.map((item) => item.id)).toEqual(["first", "second"]),
      );
      await act(async () => {
        await hook.result.current.loadMore();
      });
      expect(fetch).toHaveBeenCalledTimes(2);
      hook.unmount();
    },
  );

  it("resets when type, identity, game, category or sort changes", async () => {
    const fetch = vi.spyOn(api, "getGameFeed").mockImplementation(async () => page("first"));
    const hook = setup(queries.gameFeed("game-a", "guides", { userId: "u1" }));
    await waitFor(() => expect(hook.result.current.items).toHaveLength(1));
    await act(async () => {
      await hook.result.current.loadMore();
    });
    await waitFor(() => expect(hook.result.current.items).toHaveLength(2));
    for (const options of [
      { slug: "game-b", category: "guides", userId: "u1" },
      { slug: "game-b", category: "lore", userId: "u1" },
      { slug: "game-b", category: "lore", userId: "u2" },
      { slug: "game-b", category: "lore", userId: "u2", sort: "trending" },
      { slug: "game-b", category: "lore", userId: "u2", sort: "trending", type: "GUIDE" },
    ]) {
      const before = fetch.mock.calls.length;
      hook.rerender({ options: queries.gameFeed(options.slug, options.category, options) });
      await waitFor(() => expect(fetch.mock.calls.length).toBe(before + 1));
      expect(fetch.mock.calls.at(-1)[1].cursor).toBeUndefined();
      await waitFor(() => expect(hook.result.current.items).toHaveLength(1));
    }
    hook.unmount();
  });

  it.each([400, 410])(
    "restarts a rejected continuation (%s) and replaces old items",
    async (status) => {
      const fetch = vi
        .spyOn(api, "getTrendingFeed")
        .mockResolvedValueOnce(page("old"))
        .mockRejectedValueOnce(Object.assign(new Error("snapshot"), { status }))
        .mockResolvedValueOnce(page("fresh", false));
      const hook = setup(queries.feed("trending"));
      await waitFor(() => expect(hook.result.current.items).toHaveLength(1));
      await act(async () => {
        await hook.result.current.loadMore();
      });
      await waitFor(() => expect(hook.result.current.items).toEqual([{ id: "fresh" }]));
      expect(fetch).toHaveBeenCalledTimes(3);
      expect(fetch.mock.calls[2][0].cursor).toBeUndefined();
      hook.unmount();
    },
  );

  it("For You scopes include type and authenticated identity, and require a user", () => {
    expect(queries.feed("for-you").enabled).toBe(false);
    expect(queries.feed("for-you", { type: "GUIDE" }, "a").queryKey).not.toEqual(
      queries.feed("for-you", { type: "GUIDE" }, "b").queryKey,
    );
    expect(queries.feed("for-you", { type: "GUIDE" }, "a").queryKey).not.toEqual(
      queries.feed("for-you", { type: "LORE" }, "a").queryKey,
    );
  });
});
