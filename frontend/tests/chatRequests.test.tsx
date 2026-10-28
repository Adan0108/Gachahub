import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ChatPage from "../app/chat/page";

const mocks = vi.hoisted(() => ({
  accept: vi.fn(() => Promise.resolve({ state: "ACTIVE" })),
  decline: vi.fn(() => Promise.resolve({ state: "DECLINED" })),
  replace: vi.fn(),
  search: "",
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

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
  useSearchParams: () => new URLSearchParams(mocks.search),
}));
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

// The row has two buttons now: the one that opens the chat, and its three-dot menu.
const OPEN_ROW = /^(?!Options for).*sender/i;

describe("chat requests", () => {
  beforeEach(() => {
    mocks.accept.mockClear();
    mocks.decline.mockClear();
    mocks.replace.mockClear();
    mocks.search = "";
  });

  it("accepts a pending request", async () => {
    renderChat();
    fireEvent.click(await screen.findByRole("button", { name: /more/i }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /requests/i }));
    fireEvent.click(await screen.findByRole("button", { name: OPEN_ROW }));
    fireEvent.click(await screen.findByRole("button", { name: /accept/i }));
    await waitFor(() => expect(mocks.accept).toHaveBeenCalledWith("conversation-1"));
  });

  it("opens the conversation a clicked notification points to, then clears the address", async () => {
    mocks.search = "c=conversation-1";
    renderChat();

    // The conversation is a request, so the requests view opens with it selected.
    expect(await screen.findByRole("button", { name: /accept/i })).toBeInTheDocument();
    expect(mocks.replace).toHaveBeenCalledWith("/chat");
  });

  it("opens no conversation for an id that is not in the list", async () => {
    mocks.search = "c=somebody-elses";
    renderChat();

    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/chat"));
    expect(screen.queryByRole("button", { name: /accept/i })).toBeNull();
  });

  it("declines a pending request", async () => {
    renderChat();
    fireEvent.click(await screen.findByRole("button", { name: /more/i }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /requests/i }));
    fireEvent.click(await screen.findByRole("button", { name: OPEN_ROW }));
    fireEvent.click(await screen.findByRole("button", { name: /decline/i }));
    await waitFor(() => expect(mocks.decline).toHaveBeenCalledWith("conversation-1"));
  });
});
