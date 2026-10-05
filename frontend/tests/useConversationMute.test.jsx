import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useConversationMute } from "../hooks/chat/useConversationMute";
import { queryKeys } from "../lib/queries";

const mocks = vi.hoisted(() => ({ setChatNotificationLevel: vi.fn() }));

vi.mock("../hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ user: { id: "me" }, isAuthenticated: true }),
}));
vi.mock("../lib/api", () => ({
  api: { setChatNotificationLevel: mocks.setChatNotificationLevel },
  fallbackCategories: vi.fn(() => []),
  fallbackGame: vi.fn(),
  fallbackGames: vi.fn(() => ({ items: [] })),
  fallbackPosts: vi.fn(() => []),
}));

const seed = () => [
  {
    id: "c1",
    participants: [
      { userId: "me", notificationLevel: "ALL", mutedUntil: null, isMuted: false },
      { userId: "peer", notificationLevel: null, mutedUntil: null, isMuted: null },
    ],
  },
];

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(queryKeys.chatConversations, seed());
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const wrapper = ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const view = renderHook(() => useConversationMute("c1"), { wrapper });
  const mineNow = () =>
    client.getQueryData(queryKeys.chatConversations)[0].participants.find((p) => p.userId === "me");
  return { client, invalidate, mutate: view.result, mineNow };
}

describe("useConversationMute", () => {
  beforeEach(() => {
    mocks.setChatNotificationLevel.mockReset();
  });

  it("mutes straight away, before the server has answered", async () => {
    mocks.setChatNotificationLevel.mockReturnValue(new Promise(() => {}));
    const { mutate, mineNow } = setup();

    act(() => mutate.current.mutate({ notificationLevel: "NOTHING", mutedUntil: "2026-10-05T15:40:00.000Z" }));

    await waitFor(() => expect(mineNow().isMuted).toBe(true));
    expect(mineNow().mutedUntil).toBe("2026-10-05T15:40:00.000Z");
    expect(mocks.setChatNotificationLevel).toHaveBeenCalledWith("c1", {
      notificationLevel: "NOTHING",
      mutedUntil: "2026-10-05T15:40:00.000Z",
    });
  });

  it("syncs with the server once it answers", async () => {
    mocks.setChatNotificationLevel.mockResolvedValue({});
    const { mutate, invalidate } = setup();

    await act(() => mutate.current.mutateAsync({ notificationLevel: "NOTHING" }));

    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.chatConversations });
  });

  it("puts the list back if the server refuses", async () => {
    mocks.setChatNotificationLevel.mockRejectedValue(new Error("nope"));
    const { mutate, mineNow } = setup();

    await act(() => mutate.current.mutateAsync({ notificationLevel: "NOTHING" }).catch(() => {}));

    expect(mineNow()).toMatchObject({ notificationLevel: "ALL", isMuted: false, mutedUntil: null });
  });
});
