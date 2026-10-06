import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConversationRowMenu } from "../components/chat/ConversationRowMenu";

const mocks = vi.hoisted(() => ({
  block: vi.fn(),
  archive: vi.fn(),
  unarchive: vi.fn(),
  remove: vi.fn(),
  setNotificationLevel: vi.fn(),
}));

vi.mock("../hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ user: { id: "me" }, isAuthenticated: true }),
}));
vi.mock("../lib/api", () => ({
  api: {
    blockChatConversation: mocks.block,
    archiveChatConversation: mocks.archive,
    unarchiveChatConversation: mocks.unarchive,
    deleteChatConversation: mocks.remove,
    setChatNotificationLevel: mocks.setNotificationLevel,
  },
  fallbackCategories: vi.fn(() => []),
  fallbackGame: vi.fn(),
  fallbackGames: vi.fn(() => ({ items: [] })),
  fallbackPosts: vi.fn(() => []),
}));

const member = (id, name, extra = {}) => ({ userId: id, state: "ACTIVE", user: { id, name }, ...extra });
const dm = (extra = {}) => ({
  id: "c1",
  type: "DIRECT",
  participants: [member("me", "Me", { isMuted: false }), member("peer", "Bob")],
  ...extra,
});
const group = () =>
  dm({ type: "GROUP", title: "Squad", participants: [member("me", "Me", { isMuted: false }), member("a", "Ann"), member("b", "Bob")] });
const muted = () =>
  dm({
    participants: [member("me", "Me", { isMuted: true, mutedUntil: null, notificationLevel: "NOTHING" }), member("peer", "Bob")],
  });

function setup(conversation = dm(), { view = "inbox" } = {}) {
  const onGone = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  client.setQueryData(["chat", "conversations"], [conversation]);
  const invalidate = vi.spyOn(client, "invalidateQueries");
  render(
    <QueryClientProvider client={client}>
      <ConversationRowMenu conversation={conversation} onGone={onGone} userId="me" view={view} />
    </QueryClientProvider>,
  );
  return { onGone, invalidate };
}

const trigger = (name = "Bob") => screen.getByRole("button", { name: `Options for ${name}` });
const open = (name) => fireEvent.click(trigger(name));
const item = (name) => screen.getByRole("menuitem", { name });
const items = () => screen.getAllByRole("menuitem").map((entry) => entry.textContent.trim());

describe("ConversationRowMenu", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset().mockResolvedValue({}));
  });

  describe("the three-dot button", () => {
    it("is named for the chat it belongs to", () => {
      setup();

      expect(trigger()).toHaveAttribute("aria-haspopup", "menu");
      expect(trigger()).toHaveAttribute("aria-expanded", "false");
    });

    it("names a group by its title", () => {
      setup(group());

      expect(screen.getByRole("button", { name: "Options for Squad" })).toBeInTheDocument();
    });

    it("opens the menu, and closes it when pressed again", () => {
      setup();

      open();
      expect(screen.getByRole("menu")).toBeInTheDocument();
      expect(trigger()).toHaveAttribute("aria-expanded", "true");

      open();
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });

    it("closes on Escape and on a click elsewhere", () => {
      setup();
      open();

      fireEvent.keyDown(window, { key: "Escape" });
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();

      open();
      fireEvent.mouseDown(document.body);
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });
  });

  describe("what the menu offers", () => {
    it("has profile, mute, block, archive, delete and report for a direct chat", () => {
      setup();
      open();

      expect(items()).toEqual([
        "View profile",
        "Mute notifications",
        "Block",
        "Archive chat",
        "Delete chat",
        "Report",
      ]);
    });

    it("leaves out profile and block for a group, where there is no one person to view or block", () => {
      setup(group());
      open("Squad");

      expect(items()).toEqual(["Mute notifications", "Archive chat", "Delete chat", "Report"]);
    });

    it("offers Unarchive instead of Archive in the archived list", () => {
      setup(dm(), { view: "archived" });
      open();

      expect(items()).toContain("Unarchive chat");
      expect(items()).not.toContain("Archive chat");
    });

    it("offers neither on a message request, which cannot be archived yet", () => {
      setup(dm(), { view: "requests" });
      open();

      expect(items()).not.toContain("Archive chat");
      expect(items()).not.toContain("Unarchive chat");
      expect(items()).toContain("Delete chat");
    });

    it("offers Unmute for a muted chat", () => {
      setup(muted());
      open();

      expect(items()).toContain("Unmute notifications");
      expect(items()).not.toContain("Mute notifications");
    });
  });

  describe("view profile and report, which are not built yet", () => {
    it.each([
      ["View profile", "Viewing a profile isn't available yet."],
      ["Report", "Reporting isn't available yet."],
    ])("%s says so and closes the menu", async (label, message) => {
      setup();
      open();

      fireEvent.click(item(label));

      expect(await screen.findByRole("status")).toHaveTextContent(message);
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });

    it("does not call the server for either", () => {
      setup();
      open();
      fireEvent.click(item("Report"));

      expect(Object.values(mocks).every((mock) => mock.mock.calls.length === 0)).toBe(true);
    });
  });

  describe("mute", () => {
    it("shows how long to mute for, and can go back", () => {
      setup();
      open();

      fireEvent.click(item("Mute notifications"));
      expect(items()).toEqual(["Mute for", "15 minutes", "1 hour", "8 hours", "24 hours", "Until I turn it back on"]);

      fireEvent.click(item("Mute for"));
      expect(items()).toContain("Mute notifications");
    });

    it("mutes for the chosen time and closes the menu", async () => {
      setup();
      open();
      fireEvent.click(item("Mute notifications"));

      fireEvent.click(item("1 hour"));

      await waitFor(() => expect(mocks.setNotificationLevel).toHaveBeenCalledTimes(1));
      const [conversationId, change] = mocks.setNotificationLevel.mock.calls[0];
      expect(conversationId).toBe("c1");
      expect(change.notificationLevel).toBe("NOTHING");
      expect(Date.parse(change.mutedUntil) - Date.now()).toBeGreaterThan(59 * 60_000);
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });

    it("mutes with no end time when asked to until turned back on", async () => {
      setup();
      open();
      fireEvent.click(item("Mute notifications"));

      fireEvent.click(item("Until I turn it back on"));

      await waitFor(() => expect(mocks.setNotificationLevel).toHaveBeenCalled());
      expect(mocks.setNotificationLevel.mock.calls[0][1].mutedUntil).toBeUndefined();
    });

    it("unmutes straight away", async () => {
      setup(muted());
      open();

      fireEvent.click(item("Unmute notifications"));

      await waitFor(() => expect(mocks.setNotificationLevel).toHaveBeenCalledWith("c1", { notificationLevel: "ALL" }));
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });

    it("starts from the main menu each time it is opened", () => {
      setup();
      open();
      fireEvent.click(item("Mute notifications"));
      fireEvent.keyDown(window, { key: "Escape" });

      open();

      expect(items()).toContain("View profile");
    });
  });

  describe("archive and unarchive", () => {
    it("archives the chat and tells the list it is gone", async () => {
      const { onGone } = setup();
      open();

      fireEvent.click(item("Archive chat"));

      await waitFor(() => expect(mocks.archive).toHaveBeenCalledWith("c1"));
      await waitFor(() => expect(onGone).toHaveBeenCalledWith("c1"));
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });

    it("unarchives it from the archived list", async () => {
      const { onGone } = setup(dm(), { view: "archived" });
      open();

      fireEvent.click(item("Unarchive chat"));

      await waitFor(() => expect(mocks.unarchive).toHaveBeenCalledWith("c1"));
      await waitFor(() => expect(onGone).toHaveBeenCalledWith("c1"));
    });

    it("refreshes the lists afterwards", async () => {
      const { invalidate } = setup();
      open();

      fireEvent.click(item("Archive chat"));

      await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["chat", "archived"] }));
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["chat", "conversations"] });
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["chat", "requests"] });
    });

    it("says so, and keeps the chat in the list, when it fails", async () => {
      mocks.archive.mockRejectedValue(new Error("nope"));
      const { onGone } = setup();
      open();

      fireEvent.click(item("Archive chat"));

      expect(await screen.findByRole("status")).toHaveTextContent("Couldn't do that. Try again.");
      expect(onGone).not.toHaveBeenCalled();
    });
  });

  describe("delete chat", () => {
    it("asks first, naming what happens", () => {
      setup();
      open();

      fireEvent.click(item("Delete chat"));

      const dialog = screen.getByRole("dialog", { name: "Delete this chat?" });
      expect(within(dialog).getByText(/for you only/)).toBeInTheDocument();
      expect(mocks.remove).not.toHaveBeenCalled();
    });

    it("starts on Cancel, so a stray Enter does not delete anything", () => {
      setup();
      open();

      fireEvent.click(item("Delete chat"));

      expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    });

    it("does nothing when cancelled", () => {
      const { onGone } = setup();
      open();
      fireEvent.click(item("Delete chat"));

      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(mocks.remove).not.toHaveBeenCalled();
      expect(onGone).not.toHaveBeenCalled();
    });

    it("does nothing on Escape", () => {
      setup();
      open();
      fireEvent.click(item("Delete chat"));

      fireEvent.keyDown(window, { key: "Escape" });

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(mocks.remove).not.toHaveBeenCalled();
    });

    it("deletes when confirmed and tells the list it is gone", async () => {
      const { onGone } = setup();
      open();
      fireEvent.click(item("Delete chat"));

      fireEvent.click(screen.getByRole("button", { name: "Delete chat" }));

      await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith("c1"));
      await waitFor(() => expect(onGone).toHaveBeenCalledWith("c1"));
    });

    it("stays open with a message when deleting fails", async () => {
      mocks.remove.mockRejectedValue(new Error("nope"));
      const { onGone } = setup();
      open();
      fireEvent.click(item("Delete chat"));

      fireEvent.click(screen.getByRole("button", { name: "Delete chat" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't delete this chat. Try again.");
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(onGone).not.toHaveBeenCalled();
    });

    it("does not show the last failure when it is opened again", async () => {
      mocks.remove.mockRejectedValueOnce(new Error("nope"));
      setup();
      open();
      fireEvent.click(item("Delete chat"));
      fireEvent.click(screen.getByRole("button", { name: "Delete chat" }));
      await screen.findByRole("alert");
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

      open();
      fireEvent.click(item("Delete chat"));

      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });

  describe("block", () => {
    it("asks first, naming who is blocked", () => {
      setup();
      open();

      fireEvent.click(item("Block"));

      const dialog = screen.getByRole("dialog", { name: "Block Bob?" });
      expect(within(dialog).getByText(/read or send messages/)).toBeInTheDocument();
      expect(mocks.block).not.toHaveBeenCalled();
    });

    it("blocks when confirmed and tells the list it is gone", async () => {
      const { onGone } = setup();
      open();
      fireEvent.click(item("Block"));

      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Block" }));

      await waitFor(() => expect(mocks.block).toHaveBeenCalledWith("c1"));
      await waitFor(() => expect(onGone).toHaveBeenCalledWith("c1"));
    });

    it("does nothing when cancelled", () => {
      setup();
      open();
      fireEvent.click(item("Block"));

      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

      expect(mocks.block).not.toHaveBeenCalled();
    });

    it("stays open with a message when blocking fails", async () => {
      mocks.block.mockRejectedValue(new Error("nope"));
      setup();
      open();
      fireEvent.click(item("Block"));

      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Block" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't block this chat. Try again.");
    });

    it("disables the confirm button while it is working", async () => {
      let finish = () => {};
      mocks.block.mockReturnValue(new Promise((resolve) => (finish = () => resolve({}))));
      setup();
      open();
      fireEvent.click(item("Block"));

      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Block" }));

      await waitFor(() => expect(within(screen.getByRole("dialog")).getByRole("button", { name: "Block" })).toBeDisabled());
      await act(async () => finish());
    });
  });
});
