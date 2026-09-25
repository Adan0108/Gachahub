// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUserSearch, USER_SEARCH_DEBOUNCE_MS, type UserSearch } from "./useUserSearch";

const { searchUsers } = vi.hoisted(() => ({ searchUsers: vi.fn() }));
vi.mock("../lib/api", () => ({ api: { searchUsers } }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function renderSearch() {
  const container = document.createElement("div");
  const root = createRoot(container);
  let latest = {} as UserSearch;
  function Harness({ query }: { query: string }) {
    latest = useUserSearch(query);
    return null;
  }
  return {
    get value() {
      return latest;
    },
    render: (query: string) => act(async () => root.render(createElement(Harness, { query }))),
    advance: (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms))),
    unmount: () => act(() => root.unmount()),
  };
}

const user = (id: string) => ({ id, name: `User ${id}`, image: null });
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};

describe("useUserSearch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    searchUsers.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it("does not search below the minimum length", async () => {
    const hook = renderSearch();
    await hook.render("a");
    await hook.advance(USER_SEARCH_DEBOUNCE_MS * 2);
    expect(searchUsers).not.toHaveBeenCalled();
    expect(hook.value).toMatchObject({ isActive: false, isLoading: false, items: [] });
  });

  it("debounces rapid typing into one request for the last query", async () => {
    searchUsers.mockResolvedValue({ items: [user("1")] });
    const hook = renderSearch();
    await hook.render("al");
    await hook.advance(100);
    await hook.render("ali");
    await hook.advance(100);
    await hook.render("alic");
    expect(hook.value.isLoading).toBe(true);
    expect(searchUsers).not.toHaveBeenCalled();

    await hook.advance(USER_SEARCH_DEBOUNCE_MS);

    expect(searchUsers).toHaveBeenCalledTimes(1);
    expect(searchUsers.mock.calls[0]?.[0]).toBe("alic");
    expect(hook.value).toMatchObject({ isLoading: false, items: [user("1")] });
  });

  it("ignores a stale response that resolves after a newer one", async () => {
    const first = deferred<{ items: ReturnType<typeof user>[] }>();
    const second = deferred<{ items: ReturnType<typeof user>[] }>();
    searchUsers.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const hook = renderSearch();

    await hook.render("al");
    await hook.advance(USER_SEARCH_DEBOUNCE_MS);
    await hook.render("ali");
    await hook.advance(USER_SEARCH_DEBOUNCE_MS);
    expect(searchUsers).toHaveBeenCalledTimes(2);

    await act(async () => second.resolve({ items: [user("new")] }));
    await act(async () => first.resolve({ items: [user("stale")] }));

    expect(hook.value.items).toEqual([user("new")]);
  });

  it("does not show results of an older query while a newer one loads", async () => {
    searchUsers.mockResolvedValueOnce({ items: [user("old")] });
    const pending = deferred<{ items: ReturnType<typeof user>[] }>();
    searchUsers.mockReturnValueOnce(pending.promise);
    const hook = renderSearch();

    await hook.render("al");
    await hook.advance(USER_SEARCH_DEBOUNCE_MS);
    expect(hook.value.items).toEqual([user("old")]);

    await hook.render("ali");
    expect(hook.value).toMatchObject({ isLoading: true, items: [] });
  });

  it("reports an error and clears results", async () => {
    searchUsers.mockRejectedValue(new Error("boom"));
    const hook = renderSearch();
    await hook.render("al");
    await hook.advance(USER_SEARCH_DEBOUNCE_MS);
    expect(hook.value.error?.message).toBe("boom");
    expect(hook.value.items).toEqual([]);
  });

  it("drops the pending request when the query is cleared", async () => {
    searchUsers.mockResolvedValue({ items: [user("1")] });
    const hook = renderSearch();
    await hook.render("al");
    await hook.render("");
    await hook.advance(USER_SEARCH_DEBOUNCE_MS * 2);
    expect(searchUsers).not.toHaveBeenCalled();
  });

  it("searches the same text again after a failure when retried", async () => {
    searchUsers.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce({ items: [user("1")] });
    const hook = renderSearch();
    await hook.render("al");
    await hook.advance(USER_SEARCH_DEBOUNCE_MS);
    expect(hook.value.error).toBeDefined();

    await act(async () => hook.value.retry());
    expect(hook.value).toMatchObject({ isLoading: true, error: undefined });
    await hook.advance(USER_SEARCH_DEBOUNCE_MS);

    expect(searchUsers).toHaveBeenCalledTimes(2);
    expect(hook.value).toMatchObject({ items: [user("1")], error: undefined });
  });
});
