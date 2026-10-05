// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FeedLoadSentinel } from "../components/FeedLoadSentinel";
import { api } from "../lib/api";
import { queries } from "../lib/queries";
import { useCursorFeed } from "./useCursorFeed";
const cursor = "opaque+/=unchanged";
const page = (id: string, next: string | null = cursor) => ({
  items: [{ id }],
  meta: { limit: 20, hasMore: next !== null, nextCursor: next },
});
const cleanups: Array<() => void> = [];
let callbacks: Array<(entries: Array<{ isIntersecting: boolean }>) => void>;
const disconnect = vi.fn();
async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 15));
  });
}
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  let latest: ReturnType<typeof useCursorFeed>;
  function Harness({ kind, scope }: { kind: string; scope: string }) {
    const options =
      kind === "game"
        ? queries.gameFeed(scope, "guides")
        : queries.feed(kind, { type: scope }, "u1");
    latest = useCursorFeed({ ...options, retryDelay: 0 });
    return createElement(FeedLoadSentinel, { feed: latest });
  }
  cleanups.push(() => {
    act(() => root.unmount());
    client.clear();
    container.remove();
  });
  return {
    get value() {
      return latest!;
    },
    render: async (kind: string, scope = "GUIDE") => {
      await act(async () =>
        root.render(
          createElement(QueryClientProvider, { client }, createElement(Harness, { kind, scope })),
        ),
      );
      await flush();
    },
  };
}
async function intersect(times = 1) {
  const callback = callbacks.at(-1)!;
  await act(async () => {
    for (let i = 0; i < times; i++) callback([{ isIntersecting: true }]);
  });
  await flush();
}
beforeEach(() => {
  callbacks = [];
  disconnect.mockClear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: (typeof callbacks)[number]) {
        callbacks.push(callback);
      }
      observe() {}
      disconnect = disconnect;
    },
  );
});
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("automatic cursor infinite scrolling", () => {
  it.each(["latest", "trending", "game"])(
    "%s loads exact continuation once and stops at the end",
    async (kind) => {
      const method =
        kind === "game" ? "getGameFeed" : kind === "latest" ? "getLatestFeed" : "getTrendingFeed";
      let finish!: (value: ReturnType<typeof page>) => void;
      const fetch = vi
        .spyOn(api, method)
        .mockResolvedValueOnce(page("first"))
        .mockImplementationOnce(
          () =>
            new Promise<ReturnType<typeof page>>((resolve) => {
              finish = resolve;
            }),
        );
      const hook = setup();
      await hook.render(kind);
      expect(hook.value.items).toHaveLength(1);
      const params = (index: number) =>
        fetch.mock.calls[index]![kind === "game" ? 1 : 0] as { cursor?: string };
      expect(params(0).cursor).toBeUndefined();
      await intersect(3);
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(params(1).cursor).toBe(cursor);
      await act(async () => finish(page("second", null)));
      await flush();
      expect(hook.value.items?.map((item: { id: string }) => item.id)).toEqual(["first", "second"]);
      expect(hook.value.canLoadMore).toBe(false);
      await intersect();
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(disconnect).toHaveBeenCalled();
    },
  );
  it("changes filter scope without reusing the prior cursor or stale observer", async () => {
    const fetch = vi.spyOn(api, "getLatestFeed").mockResolvedValue(page("first"));
    const hook = setup();
    await hook.render("latest", "GUIDE");
    const oldCallback = callbacks.at(-1)!;
    await intersect();
    expect(hook.value.items).toHaveLength(2);
    await hook.render("latest", "LORE");
    expect(hook.value.items).toHaveLength(1);
    expect(fetch.mock.calls.at(-1)![0]).toEqual(
      expect.objectContaining({ type: "LORE", cursor: undefined }),
    );
    const count = fetch.mock.calls.length;
    await act(async () => oldCallback([{ isIntersecting: true }]));
    await flush();
    expect(fetch).toHaveBeenCalledTimes(count);
    await intersect();
    expect((fetch.mock.calls.at(-1)![0] as { cursor?: string }).cursor).toBe(cursor);
  });
  it.each([400, 410])(
    "restarts %s without cursor and pauses if backend repeats the rejected cursor",
    async (status) => {
      const fetch = vi
        .spyOn(api, "getTrendingFeed")
        .mockResolvedValueOnce(page("old"))
        .mockRejectedValueOnce(Object.assign(new Error("snapshot"), { status }))
        .mockResolvedValueOnce(page("fresh"));
      const hook = setup();
      await hook.render("trending");
      await intersect();
      await flush();
      expect(fetch).toHaveBeenCalledTimes(3);
      expect((fetch.mock.calls[2]![0] as { cursor?: string }).cursor).toBeUndefined();
      expect(hook.value.items).toEqual([{ id: "fresh" }]);
      expect(hook.value.recoveryPaused).toBe(true);
      await intersect(3);
      expect(fetch).toHaveBeenCalledTimes(3);
    },
  );
  it("pauses ordinary continuation failures until an explicit retry", async () => {
    const fetch = vi
      .spyOn(api, "getLatestFeed")
      .mockResolvedValueOnce(page("first"))
      .mockRejectedValue(new Error("offline"));
    const hook = setup();
    await hook.render("latest");
    await intersect();
    await flush();
    expect(hook.value.canLoadMore).toBe(false);
    await intersect();
    expect(fetch).toHaveBeenCalledTimes(3); // one configured retry, no observer loop
  });
});
