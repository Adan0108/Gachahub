import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ChatPage from "../app/chat/page";

const mocks = vi.hoisted(() => ({
  unblock: vi.fn(() => Promise.resolve({ unblockedCount: 1 })),
  conversations: [] as any[],
  blocked: [] as any[],
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
}));
vi.mock("../hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ user: { id: "viewer" }, isAuthenticated: true, isLoading: false }),
}));
vi.mock("../lib/api", () => ({
  api: {
    getChatConversations: vi.fn(() => Promise.resolve(mocks.conversations)),
    getChatRequests: vi.fn(() => Promise.resolve([])),
    getChatMessages: vi.fn(() => Promise.resolve({ items: [] })),
    unblockChatUser: mocks.unblock,
    getBlockedChatUsers: vi.fn(() => Promise.resolve({ items: mocks.blocked })),
    markChatDelivered: vi.fn(() => Promise.resolve()),
    markChatRead: vi.fn(() => Promise.resolve()),
  },
  fallbackCategories: vi.fn(() => []),
  fallbackGame: vi.fn(),
  fallbackGames: vi.fn(() => ({ items: [] })),
  fallbackPosts: vi.fn(() => []),
}));

const conversation = (blocked: any) => ({
  id: "c1",
  type: "DIRECT",
  participantState: "ACTIVE",
  updatedAt: new Date().toISOString(),
  unreadCount: 0,
  participants: [
    { userId: "viewer", state: "ACTIVE", user: { id: "viewer", name: "Viewer" } },
    { userId: "sender", state: "ACTIVE", user: { id: "sender", name: "Sender" }, isBlockedByMe: blocked },
  ],
});

function renderChat() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ChatPage />
    </QueryClientProvider>,
  );
}

const OPEN_ROW = /^(?!Options for).*sender/i;

describe("a chat with someone you blocked", () => {
  beforeEach(() => {
    mocks.unblock.mockClear();
  });

  it("stays in the list, opens, and says you blocked them instead of showing the message box", async () => {
    mocks.conversations = [conversation(true)];
    renderChat();

    fireEvent.click(await screen.findByRole("button", { name: OPEN_ROW }));

    expect(await screen.findByText("You blocked Sender")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/encrypted message/i)).not.toBeInTheDocument();
  });

  it("unblocks from the notice", async () => {
    mocks.conversations = [conversation(true)];
    renderChat();
    fireEvent.click(await screen.findByRole("button", { name: OPEN_ROW }));

    const notice = await screen.findByText("You blocked Sender");
    fireEvent.click(notice.closest(".chat-composer-disabled")!.querySelector("button")!);

    await waitFor(() => expect(mocks.unblock).toHaveBeenCalledWith("sender"));
  });

  it("shows no blocked notice for someone you have not blocked", async () => {
    mocks.conversations = [conversation(false)];
    renderChat();

    fireEvent.click(await screen.findByRole("button", { name: OPEN_ROW }));

    await waitFor(() => expect(screen.queryByText("You blocked Sender")).not.toBeInTheDocument());
  });

  describe("the Blocked list", () => {
    const openBlockedList = async () => {
      fireEvent.click(await screen.findByRole("button", { name: /more/i }));
      fireEvent.click(await screen.findByRole("menuitem", { name: /blocked/i }));
    };

    it("shows who you blocked, with Unblock, from the menu", async () => {
      mocks.conversations = [];
      mocks.blocked = [{ id: "sender", name: "Sender", username: "sender", image: null }];
      renderChat();

      await openBlockedList();

      expect(await screen.findByRole("list", { name: "Blocked people" })).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Unblock" }));
      await waitFor(() => expect(mocks.unblock).toHaveBeenCalledWith("sender"));
    });

    it("opens the chat you already have with a blocked person", async () => {
      mocks.conversations = [conversation(true)];
      mocks.blocked = [{ id: "sender", name: "Sender", username: null, image: null }];
      renderChat();

      await openBlockedList();
      fireEvent.click(await screen.findByRole("button", { name: "Open chat" }));

      expect(await screen.findByText("You blocked Sender")).toBeInTheDocument();
      expect(screen.queryByRole("list", { name: "Blocked people" })).not.toBeInTheDocument();
    });

    it("says nobody is blocked when the list is empty", async () => {
      mocks.conversations = [];
      mocks.blocked = [];
      renderChat();

      await openBlockedList();

      expect(await screen.findByText("You have not blocked anyone.")).toBeInTheDocument();
    });
  });

  describe("on a narrow window", () => {
    it("has a way back from an open chat to the list", async () => {
      mocks.conversations = [conversation(false)];
      renderChat();
      fireEvent.click(await screen.findByRole("button", { name: OPEN_ROW }));
      const back = await screen.findByRole("button", { name: "Back to conversations" });

      fireEvent.click(back);

      await waitFor(() => expect(screen.queryByRole("button", { name: "Back to conversations" })).not.toBeInTheDocument());
      expect(screen.getByRole("button", { name: OPEN_ROW })).toBeInTheDocument();
    });

    it("marks the layout so the stylesheet can show the list or the chat, not both", async () => {
      mocks.conversations = [conversation(false)];
      const { container } = renderChat();
      expect(container.querySelector(".chat-layout")).not.toHaveClass("has-chat");

      fireEvent.click(await screen.findByRole("button", { name: OPEN_ROW }));

      await waitFor(() => expect(container.querySelector(".chat-layout")).toHaveClass("has-chat"));
    });
  });
});
