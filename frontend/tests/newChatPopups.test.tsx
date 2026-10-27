import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ChatPage from "../app/chat/page";

const mocks = vi.hoisted(() => ({
  createDirectMessage: vi.fn(),
  createGroupChat: vi.fn(),
  followStatus: { following: false, followsMe: false },
}));

const friend = {
  id: "friend",
  type: "DIRECT",
  updatedAt: new Date().toISOString(),
  unreadCount: 0,
  participants: [
    { userId: "viewer", user: { id: "viewer", name: "Viewer" } },
    { userId: "friend", user: { id: "friend", name: "Friend Fox", username: "foxy", image: null } },
  ],
};

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
}));
vi.mock("../hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ user: { id: "viewer" }, isAuthenticated: true, isLoading: false }),
}));
vi.mock("../lib/api", () => ({
  api: {
    getChatConversations: vi.fn(() => Promise.resolve([friend])),
    getChatRequests: vi.fn(() => Promise.resolve([])),
    getChatMessages: vi.fn(() => Promise.resolve({ items: [] })),
    getFollowStatus: vi.fn(() => Promise.resolve(mocks.followStatus)),
    searchUsers: vi.fn(() => Promise.resolve({ items: [] })),
    createDirectMessage: mocks.createDirectMessage,
    createGroupChat: mocks.createGroupChat,
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

async function openCompose(item: "New Chat" | "New Group") {
  fireEvent.click(await screen.findByRole("button", { name: "New conversation" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: new RegExp(item) }));
}

describe("New chat and New group popups", () => {
  beforeEach(() => {
    mocks.createDirectMessage.mockReset().mockResolvedValue({ conversationId: "friend", recipientState: "ACTIVE" });
    mocks.createGroupChat.mockReset().mockResolvedValue({ id: "g1" });
    mocks.followStatus = { following: false, followsMe: false };
  });

  it("opens New chat as a popup, with the people you chat with listed before anything is typed", async () => {
    renderChat();
    await openCompose("New Chat");

    expect(await screen.findByRole("dialog", { name: "New chat" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Friend Fox" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Recipient")).not.toBeInTheDocument();
  });

  it("picks one person at a time and offers a message request to someone who does not follow back", async () => {
    renderChat();
    await openCompose("New Chat");

    fireEvent.click(await screen.findByRole("radio", { name: "Friend Fox" }));

    expect(await screen.findByRole("button", { name: "Send message request" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Send message request" }));
    await waitFor(() =>
      expect(mocks.createDirectMessage).toHaveBeenCalledWith(expect.objectContaining({ recipientUserId: "friend" })),
    );
  });

  it("says Open chat for someone you follow each other", async () => {
    mocks.followStatus = { following: true, followsMe: true };
    renderChat();
    await openCompose("New Chat");

    fireEvent.click(await screen.findByRole("radio", { name: "Friend Fox" }));

    expect(await screen.findByRole("button", { name: "Open chat" })).toBeInTheDocument();
  });

  it("shows why someone cannot be messaged instead of failing silently", async () => {
    mocks.createDirectMessage.mockRejectedValue(new Error("This person is not accepting new messages"));
    renderChat();
    await openCompose("New Chat");
    fireEvent.click(await screen.findByRole("radio", { name: "Friend Fox" }));

    fireEvent.click(await screen.findByRole("button", { name: /Send message request|Open chat/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent("This person is not accepting new messages");
  });

  it("opens New group as a popup that needs a name and shows how many more can join", async () => {
    renderChat();
    await openCompose("New Group");

    expect(await screen.findByRole("dialog", { name: "New group" })).toBeInTheDocument();
    expect(screen.getByText("You can add 99 more people")).toBeInTheDocument();

    fireEvent.click(await screen.findByRole("checkbox", { name: "Friend Fox" }));
    expect(screen.getByText("You can add 98 more people")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create group" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Group name"), { target: { value: "Squad" } });
    fireEvent.click(screen.getByRole("button", { name: "Create group" }));

    await waitFor(() =>
      expect(mocks.createGroupChat).toHaveBeenCalledWith({ title: "Squad", memberUserIds: ["friend"] }),
    );
  });

  it("closes with Escape", async () => {
    renderChat();
    await openCompose("New Chat");
    await screen.findByRole("dialog", { name: "New chat" });

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "New chat" })).not.toBeInTheDocument());
  });
});
