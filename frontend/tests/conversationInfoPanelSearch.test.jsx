import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { ConversationInfoPanel } from "../components/chat/ConversationInfoPanel";

vi.mock("../hooks/chat/useMessageSearchIndex", () => ({
  useMessageSearchIndex: () => ({
    index: { search: () => ({ terms: [], hits: [] }) },
    status: "ready",
    version: 0,
    indexed: 0,
    total: 0,
  }),
}));
vi.mock("../hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ user: { id: "me" }, isAuthenticated: true }),
}));
vi.mock("../lib/api", () => ({
  api: {},
  fallbackCategories: vi.fn(() => []),
  fallbackGame: vi.fn(),
  fallbackGames: vi.fn(() => ({ items: [] })),
  fallbackPosts: vi.fn(() => []),
}));

const conversation = {
  id: "c1",
  type: "DIRECT",
  participants: [
    { userId: "me", state: "ACTIVE", user: { id: "me", name: "Me" } },
    { userId: "peer", state: "ACTIVE", user: { id: "peer", name: "Mado" } },
  ],
};

const search = {
  messagesById: new Map(),
  hiddenMessageIds: new Set(),
  history: {
    hasMoreHistory: false,
    isLoadingOlder: false,
    isWaitingOnRateLimit: false,
    rateLimitSecondsLeft: 0,
    historyError: undefined,
    retryHistory: vi.fn(),
    loadOlderMessages: vi.fn(),
  },
  onJump: vi.fn(),
};

const panel = (searchSeed = null) => (
  <QueryClientProvider client={new QueryClient()}>
    <ConversationInfoPanel
      conversation={conversation}
      displayName="Mado"
      encryptionStatus="Encrypted"
      fileAttachments={[]}
      isOpen
      onClose={vi.fn()}
      onOpenAttachment={vi.fn()}
      search={search}
      searchSeed={searchSeed}
      userId="me"
      visualAttachments={[]}
    />
  </QueryClientProvider>
);

const searchBox = () => screen.queryByRole("textbox", { name: "Search this conversation" });

describe("ConversationInfoPanel search", () => {
  it("opens the search view from the Search button, and goes back", () => {
    render(panel());
    expect(searchBox()).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    expect(searchBox()).toBeInTheDocument();
    expect(screen.getByText("Search", { selector: "b" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(searchBox()).not.toBeInTheDocument();
  });

  it("opens straight on the search view with the text it was seeded with", () => {
    render(panel({ conversationId: "c1", query: "pizza", nonce: 1 }));

    expect(searchBox()).toHaveValue("pizza");
  });

  it("switches to the search view when a seed arrives while the panel is open", () => {
    const { rerender } = render(panel());
    expect(searchBox()).not.toBeInTheDocument();

    rerender(panel({ conversationId: "c1", query: "pizza", nonce: 1 }));

    expect(searchBox()).toHaveValue("pizza");
  });

  it("takes a newer seed over what was typed", () => {
    const { rerender } = render(panel({ conversationId: "c1", query: "pizza", nonce: 1 }));
    fireEvent.change(searchBox(), { target: { value: "something else" } });

    rerender(panel({ conversationId: "c1", query: "tacos", nonce: 2 }));

    expect(searchBox()).toHaveValue("tacos");
  });
});
