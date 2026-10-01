import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ChatPage from "../app/chat/page";

const mocks = vi.hoisted(() => ({
  accept: vi.fn(() => Promise.resolve({ state: "ACTIVE" })),
  decline: vi.fn(() => Promise.resolve({ state: "DECLINED" })),
}));

const request = {
  id: "conversation-1",
  updatedAt: new Date().toISOString(),
  unreadCount: 0,
  participants: [
    { userId: "viewer", user: { id: "viewer", name: "Viewer" } },
    { userId: "sender", user: { id: "sender", name: "Sender" } },
  ],
};

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("../hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({
    user: { id: "viewer" },
    isAuthenticated: true,
    isLoading: false,
  }),
}));
vi.mock("../lib/api", () => ({
  api: {
    getChatConversations: vi.fn(() => Promise.resolve([])),
    getChatRequests: vi.fn(() => Promise.resolve([request])),
    getChatMessages: vi.fn(() => Promise.resolve({ items: [] })),
    acceptChatRequest: mocks.accept,
    declineChatRequest: mocks.decline,
    blockChatConversation: vi.fn(() => Promise.resolve()),
    markChatDelivered: vi.fn(() => Promise.resolve()),
    markChatRead: vi.fn(() => Promise.resolve()),
  },
  fallbackCategories: vi.fn(() => []),
  fallbackGame: vi.fn(),
  fallbackGames: vi.fn(() => ({ items: [] })),
  fallbackPosts: vi.fn(() => []),
}));

function renderChat() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ChatPage />
    </QueryClientProvider>,
  );
}

describe("chat requests", () => {
  beforeEach(() => {
    mocks.accept.mockClear();
    mocks.decline.mockClear();
  });

  it("accepts a pending request", async () => {
    renderChat();
    fireEvent.click(await screen.findByRole("tab", { name: /requests/i }));
    fireEvent.click(await screen.findByRole("button", { name: /accept/i }));
    await waitFor(() => expect(mocks.accept).toHaveBeenCalledWith("conversation-1"));
  });

  it("declines a pending request", async () => {
    renderChat();
    fireEvent.click(await screen.findByRole("tab", { name: /requests/i }));
    fireEvent.click(await screen.findByRole("button", { name: /decline/i }));
    await waitFor(() => expect(mocks.decline).toHaveBeenCalledWith("conversation-1"));
  });
});
