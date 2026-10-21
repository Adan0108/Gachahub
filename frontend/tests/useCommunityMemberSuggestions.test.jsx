import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCommunityMemberSuggestions } from "../hooks/community/useCommunityMemberSuggestions";

const mocks = vi.hoisted(() => ({ searchCommunityMembers: vi.fn() }));
vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, api: { ...actual.api, ...mocks } };
});

const wrapper = ({ children }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

describe("useCommunityMemberSuggestions", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mocks.searchCommunityMembers.mockReset();
    mocks.searchCommunityMembers.mockResolvedValue({ items: [{ id: "u1", username: "bobby" }] });
  });
  afterEach(() => vi.useRealTimers());

  it("asks nothing while no @ is being typed", () => {
    const { result } = renderHook(() => useCommunityMemberSuggestions("wuwa", undefined), { wrapper });

    expect(result.current.items).toEqual([]);
    expect(mocks.searchCommunityMembers).not.toHaveBeenCalled();
  });

  it("asks this community for members matching what was typed, once typing pauses", async () => {
    const { result, rerender } = renderHook(({ query }) => useCommunityMemberSuggestions("wuwa", query), {
      wrapper,
      initialProps: { query: undefined },
    });
    rerender({ query: "b" });
    rerender({ query: "bo" });
    rerender({ query: "bob" });
    await act(async () => vi.advanceTimersByTimeAsync(300));

    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(mocks.searchCommunityMembers).toHaveBeenCalledTimes(1);
    expect(mocks.searchCommunityMembers.mock.calls[0][0]).toBe("wuwa");
    expect(mocks.searchCommunityMembers.mock.calls[0][1]).toBe("bob");
  });

  it("lists a few members for a bare @", async () => {
    const { result } = renderHook(() => useCommunityMemberSuggestions("wuwa", ""), { wrapper });
    await act(async () => vi.advanceTimersByTimeAsync(300));

    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(mocks.searchCommunityMembers.mock.calls[0][1]).toBe("");
  });

  it("clears the list when the @ is left", async () => {
    const { result, rerender } = renderHook(({ query }) => useCommunityMemberSuggestions("wuwa", query), {
      wrapper,
      initialProps: { query: "bo" },
    });
    await act(async () => vi.advanceTimersByTimeAsync(300));
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    rerender({ query: undefined });

    expect(result.current.items).toEqual([]);
  });
});
