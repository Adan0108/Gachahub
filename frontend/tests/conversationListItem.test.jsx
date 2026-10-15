import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConversationListItem } from "../components/chat/ConversationListItem";
import { queryKeys } from "../lib/queries";

const NOW = new Date("2026-10-05T12:00:00.000Z");
const minuteAgo = () => new Date(NOW.valueOf() - 60_000).toISOString();

const member = (id, name, extra = {}) => ({ userId: id, state: "ACTIVE", user: { id, name }, ...extra });

const dm = (overrides = {}) => ({
  id: "c1",
  type: "DIRECT",
  updatedAt: minuteAgo(),
  unreadCount: 0,
  lastMessage: { id: "m1", senderId: "peer", createdAt: minuteAgo() },
  participants: [member("me", "Me", { isMuted: false }), member("peer", "devTest_mur")],
  ...overrides,
});

function renderRow(conversation, props = {}, typing = []) {
  const client = new QueryClient();
  client.setQueryData(queryKeys.chatTyping(conversation.id), typing);
  const onSelect = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <ConversationListItem conversation={conversation} onSelect={onSelect} userId="me" {...props} />
    </QueryClientProvider>,
  );
  return { onSelect };
}

describe("ConversationListItem", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it("shows the last message with how long ago", () => {
    renderRow(dm(), { preview: "Ok :>" });

    expect(screen.getByText("Ok :>")).toBeInTheDocument();
    expect(screen.getByText("· 1m")).toBeInTheDocument();
  });

  it("falls back to an encrypted-message line when nothing is decrypted yet", () => {
    renderRow(dm());

    expect(screen.getByText(/Encrypted message/)).toBeInTheDocument();
    expect(screen.getByText("· 1m")).toBeInTheDocument();
  });

  it("shows the member count for a group with no preview", () => {
    renderRow(
      dm({ type: "GROUP", title: "Squad", participants: [member("me", "Me"), member("a", "A"), member("b", "B")] }),
    );

    expect(screen.getByText(/3 members/)).toBeInTheDocument();
  });

  it("shows typing instead of the message while the peer types", () => {
    renderRow(dm(), { preview: "Ok :>" }, ["peer"]);

    expect(screen.getByText("typing...")).toBeInTheDocument();
    expect(screen.queryByText("Ok :>")).not.toBeInTheDocument();
  });

  it("names who is typing in a group", () => {
    renderRow(dm({ type: "GROUP", title: "Squad", participants: [member("me", "Me"), member("a", "Mado")] }), {}, ["a"]);

    expect(screen.getByText("Mado is typing...")).toBeInTheDocument();
  });

  it("ignores your own typing", () => {
    renderRow(dm(), { preview: "Ok :>" }, ["me"]);

    expect(screen.getByText("Ok :>")).toBeInTheDocument();
  });

  it("marks an unread preview and shows the count", () => {
    renderRow(dm({ unreadCount: 3 }), { preview: "hey" });

    expect(screen.getByText("hey").closest(".chat-list-preview")).toHaveClass("unread");
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("shows the muted icon and a muted badge", () => {
    renderRow(
      dm({ unreadCount: 2, participants: [member("me", "Me", { isMuted: true }), member("peer", "devTest_mur")] }),
      { preview: "hey" },
    );

    expect(screen.getByLabelText("Muted")).toBeInTheDocument();
    expect(screen.getByText("2")).toHaveClass("muted");
  });

  it("selects the conversation on click", () => {
    const { onSelect } = renderRow(dm(), { preview: "hey" });

    fireEvent.click(screen.getByRole("button", { name: /^(?!Options for)/ }));

    expect(onSelect).toHaveBeenCalledWith("c1");
  });

  describe("the three-dot menu", () => {
    it("is a button of its own beside the one that opens the chat, not inside it", () => {
      renderRow(dm(), { preview: "hey" });

      const more = screen.getByRole("button", { name: "Options for devTest_mur" });
      const open = screen.getByRole("button", { name: /^(?!Options for)/ });
      expect(open).not.toContainElement(more);
      expect(more.parentElement).toBe(open.parentElement);
    });

    it("opens its menu without opening the chat", () => {
      const { onSelect } = renderRow(dm(), { preview: "hey" });

      fireEvent.click(screen.getByRole("button", { name: "Options for devTest_mur" }));

      expect(screen.getByRole("menu")).toBeInTheDocument();
      expect(onSelect).not.toHaveBeenCalled();
    });

    it("marks the row active, not just the button inside it", () => {
      renderRow(dm(), { active: true });

      const row = screen.getByRole("button", { name: /^(?!Options for)/ }).parentElement;
      expect(row).toHaveClass("chat-conversation-row", "active");
    });

    it("is not marked active when the chat is not open", () => {
      renderRow(dm(), { active: false });

      expect(screen.getByRole("button", { name: /^(?!Options for)/ }).parentElement).not.toHaveClass("active");
    });

    it("gives the menu the list it is in, so Archive and Unarchive are the right way round", () => {
      renderRow(dm(), { view: "archived" });

      fireEvent.click(screen.getByRole("button", { name: "Options for devTest_mur" }));

      expect(screen.getByRole("menuitem", { name: "Unarchive chat" })).toBeInTheDocument();
    });
  });
});
