import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CommunityChat } from "../components/community/CommunityChat";

const mocks = vi.hoisted(() => ({ chat: null, user: null, options: [], suggestions: [] }));

vi.mock("../hooks/community/useCommunityChat", () => ({
  useCommunityChat: (_slug, options) => {
    mocks.options.push(options);
    return mocks.chat;
  },
}));
vi.mock("../hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: mocks.user }) }));
vi.mock("../hooks/community/useCommunityMemberSuggestions", () => ({
  useCommunityMemberSuggestions: (_slug, query) => ({
    items: typeof query === "string" ? mocks.suggestions.filter((member) => member.username.startsWith(query)) : [],
    isLoading: false,
  }),
}));
vi.mock("../components/chat/EmojiPicker", () => ({
  EmojiPicker: ({ onPick }) => (
    <button onClick={() => onPick({ kind: "emoji", emoji: "🎉" })} type="button">
      pick party
    </button>
  ),
}));

const TODAY = new Date();
const at = (minutesAgo) => new Date(TODAY.getTime() - minutesAgo * 60_000).toISOString();

const author = (id, name, badge = null) => ({ id, name, image: null, badge });
const message = (id, minutesAgo, extra = {}) => ({
  id,
  channelId: "c1",
  content: `text ${id}`,
  deleted: false,
  blocked: false,
  createdAt: at(minutesAgo),
  editedAt: null,
  author: author("ann", "Ann"),
  replyTo: null,
  media: [],
  mentions: [],
  reactions: [],
  ...extra,
});

const mutation = () => ({
  mutate: vi.fn(),
  mutateAsync: vi.fn().mockResolvedValue({}),
  isPending: false,
  error: null,
  reset: vi.fn(),
});

const chatState = (extra = {}) => ({
  channel: {
    id: "c1",
    name: "general",
    topic: "Talk about the game",
    kind: "TEXT",
    isLocked: false,
    slowmodeSeconds: 0,
  },
  canModerate: false,
  messages: [],
  pending: [],
  isLoading: false,
  needsToJoin: false,
  error: null,
  reload: vi.fn(),
  hasOlder: false,
  isLoadingOlder: false,
  loadOlder: vi.fn(),
  send: vi.fn(),
  retry: vi.fn(),
  discard: vi.fn(),
  edit: mutation(),
  remove: mutation(),
  react: mutation(),
  markRead: vi.fn(),
  ...extra,
});

const renderChat = (props = {}) =>
  render(
    <CommunityChat
      canJoin
      communityName="Wuthering Waves"
      isJoined
      isJoining={false}
      onJoin={vi.fn()}
      slug="wuwa"
      {...props}
    />,
  );

const composer = () => screen.getByRole("textbox", { name: "Message #general" });
const type = (text) => fireEvent.change(composer(), { target: { value: text } });
const enter = () => fireEvent.keyDown(composer(), { key: "Enter" });

describe("CommunityChat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.options = [];
    mocks.suggestions = [];
    Element.prototype.scrollIntoView = vi.fn();
    mocks.user = { id: "me", name: "Me", image: null };
    mocks.chat = chatState();
  });

  describe("before the room opens", () => {
    it("asks a signed-out visitor to log in", () => {
      mocks.user = null;

      renderChat();

      expect(screen.getByText("Log in to chat")).toBeInTheDocument();
    });

    it("points a signed-out visitor to the login page and asks the server nothing", () => {
      mocks.user = null;

      renderChat({ isJoined: false });

      expect(screen.getByRole("link", { name: "Log in" })).toHaveAttribute("href", "/login");
      expect(screen.queryByRole("button", { name: /join community/i })).not.toBeInTheDocument();
      expect(mocks.options.every((options) => options.enabled === false)).toBe(true);
    });

    it("does not ask the server for a room before the person has joined", () => {
      mocks.chat = chatState({ channel: null });

      renderChat({ isJoined: false });

      expect(mocks.options.every((options) => options.enabled === false)).toBe(true);
    });

    it("asks the server for the room once the person has joined", () => {
      renderChat({ isJoined: true });

      expect(mocks.options.at(-1)).toEqual({ enabled: true });
    });

    it("waits for the membership answer instead of flashing the join prompt", () => {
      mocks.chat = chatState({ channel: null });

      const { container } = renderChat({ isJoined: false, isCheckingMembership: true });

      expect(container.querySelector(".community-skeleton")).toBeInTheDocument();
      expect(screen.queryByText(/Join Wuthering Waves to chat/)).not.toBeInTheDocument();
    });

    it("asks someone who has not joined to join, and says the room is public to members and moderators", () => {
      const onJoin = vi.fn();
      mocks.chat = chatState({ channel: null, needsToJoin: true });

      renderChat({ isJoined: false, onJoin });
      fireEvent.click(screen.getByRole("button", { name: /join community/i }));

      expect(screen.getByText("Join Wuthering Waves to chat")).toBeInTheDocument();
      expect(screen.getByText(/public to members and moderators/i)).toBeInTheDocument();
      expect(onJoin).toHaveBeenCalled();
    });

    it("shows a failure with a retry", () => {
      const reload = vi.fn();
      mocks.chat = chatState({ channel: null, error: new Error("boom"), reload });

      renderChat();
      fireEvent.click(screen.getByRole("button", { name: /try again/i }));

      expect(screen.getByText("boom")).toBeInTheDocument();
      expect(reload).toHaveBeenCalled();
    });

    it("holds its place while loading", () => {
      mocks.chat = chatState({ channel: null, isLoading: true });

      const { container } = renderChat({ isJoined: true });

      expect(container.querySelector(".community-skeleton")).toBeInTheDocument();
    });

    it("welcomes the first person into an empty room", () => {
      renderChat();

      expect(screen.getByText("Welcome to #general")).toBeInTheDocument();
    });
  });

  describe("the room", () => {
    it("shows the room name and topic", () => {
      renderChat();

      expect(screen.getByRole("heading", { name: "general" })).toBeInTheDocument();
      expect(screen.getByText("Talk about the game")).toBeInTheDocument();
    });

    it("shows a day divider and one name for a quick run of messages by the same person", () => {
      mocks.chat = chatState({ messages: [message("m1", 3), message("m2", 2), message("m3", 1)] });

      renderChat();

      expect(screen.getByText("Today")).toBeInTheDocument();
      expect(screen.getAllByText("Ann")).toHaveLength(1);
      expect(screen.getByText("text m1")).toBeInTheDocument();
      expect(screen.getByText("text m3")).toBeInTheDocument();
    });

    it("badges moderators and admins", () => {
      mocks.chat = chatState({
        messages: [
          message("m1", 5, { author: author("bo", "Bo", "MODERATOR") }),
          message("m2", 4, { author: author("root", "Root", "ADMIN") }),
        ],
      });

      renderChat();

      expect(screen.getByText("Mod")).toBeInTheDocument();
      expect(screen.getByText("Admin")).toBeInTheDocument();
    });

    it("shows a removed message as removed, without its text", () => {
      mocks.chat = chatState({ messages: [message("m1", 2, { deleted: true, content: null })] });

      renderChat();

      expect(screen.getByText("Message removed")).toBeInTheDocument();
    });

    it("marks an edited message and shows a deleted author as such", () => {
      mocks.chat = chatState({
        messages: [message("m1", 2, { editedAt: at(1), author: null })],
      });

      renderChat();

      expect(screen.getByText("(edited)")).toBeInTheDocument();
      expect(screen.getByText("Deleted user")).toBeInTheDocument();
    });

    it("quotes the message a reply answers, and jumps to it", () => {
      mocks.chat = chatState({
        messages: [
          message("m1", 5, { author: author("bo", "Bo") }),
          message("m2", 4, {
            replyTo: {
              id: "m1",
              content: "text m1",
              deleted: false,
              blocked: false,
              authorName: "Bo",
            },
          }),
        ],
      });

      renderChat();
      fireEvent.click(screen.getByRole("button", { name: /Bo\s*text m1/ }));

      expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    });

    it("shows a message you blocked as a placeholder, with no name, text or toolbar", () => {
      mocks.chat = chatState({
        messages: [
          message("m1", 3, { blocked: true, content: null, author: null }),
          message("m2", 2),
        ],
      });

      renderChat();

      expect(screen.getByText("Blocked message")).toBeInTheDocument();
      const row = screen.getByText("Blocked message").closest(".community-message");
      expect(within(row).queryByRole("button")).not.toBeInTheDocument();
      expect(screen.getByText("text m2")).toBeInTheDocument();
    });

    it("shows a quote of someone you blocked as blocked", () => {
      mocks.chat = chatState({
        messages: [
          message("m2", 4, {
            replyTo: { id: "m1", content: null, deleted: false, blocked: true, authorName: null },
          }),
        ],
      });

      renderChat();

      expect(screen.getByText("Blocked message")).toBeInTheDocument();
      expect(screen.queryByText("Deleted user")).not.toBeInTheDocument();
    });

    it("shows reactions, and a tap on one takes back yours", () => {
      const chat = chatState({
        messages: [
          message("m1", 2, {
            reactions: [
              { userId: "me", emoji: "👍", emoteId: null, emote: null },
              { userId: "bo", emoji: "👍", emoteId: null, emote: null },
            ],
          }),
        ],
      });
      mocks.chat = chat;

      renderChat();
      fireEvent.click(screen.getByRole("button", { name: /👍\s*2/ }));

      expect(chat.react.mutate).toHaveBeenCalledWith({ messageId: "m1", choice: null });
    });

    it("loads older messages from the top", () => {
      const chat = chatState({ messages: [message("m1", 2)], hasOlder: true });
      mocks.chat = chat;

      renderChat();
      fireEvent.click(screen.getByRole("button", { name: "Load earlier messages" }));

      expect(chat.loadOlder).toHaveBeenCalled();
    });

    it("marks the room read once the newest message has been on screen a moment", async () => {
      const chat = chatState({ messages: [message("m1", 3), message("m2", 2)] });
      mocks.chat = chat;

      renderChat();

      await waitFor(() => expect(chat.markRead).toHaveBeenCalledWith("m2"), { timeout: 2000 });
    });
  });

  describe("writing", () => {
    it("sends on Enter and clears the box", () => {
      const chat = chatState();
      mocks.chat = chat;
      renderChat();

      type("hello there");
      enter();

      expect(chat.send).toHaveBeenCalledWith("hello there", null, []);
      expect(composer()).toHaveValue("");
    });

    it("adds a line on Shift+Enter instead of sending", () => {
      const chat = chatState();
      mocks.chat = chat;
      renderChat();

      type("one");
      fireEvent.keyDown(composer(), { key: "Enter", shiftKey: true });

      expect(chat.send).not.toHaveBeenCalled();
    });

    it("does not send an empty message", () => {
      const chat = chatState();
      mocks.chat = chat;
      renderChat();

      type("   ");
      enter();

      expect(chat.send).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
    });

    it("shows how many characters are left only near the limit", () => {
      renderChat();

      type("short");
      expect(screen.queryByText(/\/2000/)).not.toBeInTheDocument();

      type("x".repeat(1850));
      expect(screen.getByText("1850/2000")).toBeInTheDocument();
    });

    it("puts a picked emoji into the message", () => {
      renderChat();
      type("party ");

      fireEvent.click(screen.getByRole("button", { name: "Add an emoji" }));
      fireEvent.click(screen.getByRole("button", { name: "pick party" }));

      expect(composer().value).toContain("🎉");
    });

    it("replies to a message, sends it with the reply, then goes back to normal", async () => {
      const chat = chatState({ messages: [message("m1", 2)] });
      mocks.chat = chat;
      renderChat();

      fireEvent.click(screen.getByRole("button", { name: "Reply" }));
      expect(screen.getByText(/Replying to/)).toBeInTheDocument();

      type("agreed");
      enter();

      expect(chat.send).toHaveBeenCalledWith(
        "agreed",
        expect.objectContaining({ id: "m1" }),
        [],
      );
      await waitFor(() => expect(screen.queryByText(/Replying to/)).not.toBeInTheDocument());
    });

    it("cancels a reply", () => {
      mocks.chat = chatState({ messages: [message("m1", 2)] });
      renderChat();
      fireEvent.click(screen.getByRole("button", { name: "Reply" }));

      fireEvent.click(screen.getByRole("button", { name: "Cancel reply" }));

      expect(screen.queryByText(/Replying to/)).not.toBeInTheDocument();
    });

    it("says why you cannot write in a locked room, unless you moderate it", () => {
      const locked = {
        id: "c1",
        name: "general",
        topic: null,
        kind: "TEXT",
        isLocked: true,
        slowmodeSeconds: 0,
      };
      mocks.chat = chatState({ channel: locked });
      const { unmount } = renderChat();
      expect(screen.getByText("This channel is locked.")).toBeInTheDocument();
      expect(screen.queryByRole("textbox", { name: "Message #general" })).not.toBeInTheDocument();
      unmount();

      mocks.chat = chatState({ channel: locked, canModerate: true });
      renderChat();
      expect(composer()).toBeInTheDocument();
    });

    it("keeps announcements to moderators", () => {
      const announcements = {
        id: "c1",
        name: "news",
        topic: null,
        kind: "ANNOUNCEMENT",
        isLocked: false,
        slowmodeSeconds: 0,
      };
      mocks.chat = chatState({ channel: announcements });

      renderChat();

      expect(screen.getByText("Only moderators can post in this channel.")).toBeInTheDocument();
    });

    it("tells members about slow mode", () => {
      mocks.chat = chatState({
        channel: {
          id: "c1",
          name: "general",
          topic: null,
          kind: "TEXT",
          isLocked: false,
          slowmodeSeconds: 30,
        },
      });

      renderChat();

      expect(screen.getByText(/one message every 30s/)).toBeInTheDocument();
    });
  });

  describe("images", () => {
    const png = (name = "a.png", extra = {}) =>
      new File(["x"], name, { type: "image/png", ...extra });
    const choose = (...files) =>
      fireEvent.change(screen.getByLabelText("Choose images", { selector: "input" }), {
        target: { files },
      });

    beforeEach(() => {
      URL.createObjectURL = vi.fn(() => "blob:preview");
      URL.revokeObjectURL = vi.fn();
    });

    it("sends pictures with no text, and clears them", async () => {
      const chat = chatState();
      mocks.chat = chat;
      renderChat();
      const file = png();

      choose(file);
      await screen.findByRole("list", { name: "Images to send" });
      fireEvent.click(screen.getByRole("button", { name: "Send message" }));

      expect(chat.send).toHaveBeenCalledWith("", null, [file]);
      expect(screen.queryByRole("list", { name: "Images to send" })).not.toBeInTheDocument();
    });

    it("keeps send off until there is text or a picture", async () => {
      renderChat();
      expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();

      choose(png());

      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Send message" })).toBeEnabled(),
      );
    });

    it("takes a picture back out before sending", async () => {
      const chat = chatState();
      mocks.chat = chat;
      renderChat();
      choose(png("a.png"), png("b.png"));
      await screen.findByRole("list", { name: "Images to send" });

      fireEvent.click(screen.getByRole("button", { name: "Remove a.png" }));
      type("hi");
      enter();

      expect(chat.send).toHaveBeenCalledWith("hi", null, [expect.objectContaining({ name: "b.png" })]);
    });

    it("stops at four pictures and says so", async () => {
      renderChat();

      choose(png("1.png"), png("2.png"), png("3.png"), png("4.png"), png("5.png"));

      expect(await screen.findByRole("alert")).toHaveTextContent("up to 4 images");
      expect(within(screen.getByRole("list", { name: "Images to send" })).getAllByRole("listitem")).toHaveLength(4);
      expect(screen.getByRole("button", { name: "Add images" })).toBeDisabled();
    });

    it("refuses a file that is not a picture, and one that is too big", async () => {
      renderChat();

      choose(new File(["x"], "notes.pdf", { type: "application/pdf" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("notes.pdf: Use a JPG, PNG, WebP or GIF image");
      expect(screen.queryByRole("list", { name: "Images to send" })).not.toBeInTheDocument();

      const big = png("big.png");
      Object.defineProperty(big, "size", { value: 11 * 1024 * 1024 });
      choose(big);
      await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("10 MB or smaller"));
    });

    it("takes pictures that are pasted or dropped on the box", async () => {
      renderChat();

      fireEvent.paste(composer(), { clipboardData: { files: [png("pasted.png")] } });
      fireEvent.drop(composer(), { dataTransfer: { files: [png("dropped.png")] } });

      await screen.findByRole("button", { name: "Remove pasted.png" });
      expect(screen.getByRole("button", { name: "Remove dropped.png" })).toBeInTheDocument();
    });

    it("tells you while dragging whether the room takes what you hold", () => {
      const { container } = renderChat();
      const room = container.querySelector(".community-chat");
      const drag = (type) =>
        fireEvent.dragOver(room, { dataTransfer: { items: [{ kind: "file", type }], dropEffect: "" } });

      drag("image/png");
      expect(screen.getByRole("status", { name: "" })).toHaveTextContent("Drop to add this image");

      drag("application/pdf");
      expect(screen.getByText(/not supported/)).toBeInTheDocument();
      expect(container.querySelector(".community-drop-overlay.refused")).not.toBeNull();

      fireEvent.dragLeave(room, { relatedTarget: null });
      expect(container.querySelector(".community-drop-overlay")).toBeNull();
    });

    it("takes a picture dropped anywhere in the room", async () => {
      const { container } = renderChat();

      fireEvent.drop(container.querySelector(".community-chat"), {
        dataTransfer: { files: [png("dropped.png")], items: [] },
      });

      await screen.findByRole("button", { name: "Remove dropped.png" });
    });

    it("shows the pictures of a message and opens them in a viewer you can step through", () => {
      const media = [
        { id: "i1", url: "https://cdn/1.png", width: 10, height: 10 },
        { id: "i2", url: "https://cdn/2.png", width: 10, height: 10 },
      ];
      mocks.chat = chatState({ messages: [message("m1", 2, { content: "", media })] });
      renderChat();

      fireEvent.click(screen.getByRole("button", { name: "Open image 1 of 2" }));
      const viewer = screen.getByRole("dialog", { name: "Image viewer" });
      expect(within(viewer).getByRole("img")).toHaveAttribute("src", "https://cdn/1.png");

      fireEvent.click(screen.getByRole("button", { name: "Next" }));
      expect(within(viewer).getByRole("img")).toHaveAttribute("src", "https://cdn/2.png");

      fireEvent.keyDown(window, { key: "Escape" });
      expect(screen.queryByRole("dialog", { name: "Image viewer" })).not.toBeInTheDocument();
    });

    it("shows no empty text line for a picture-only message, and no pictures once removed", () => {
      const media = [{ id: "i1", url: "https://cdn/1.png", width: 10, height: 10 }];
      mocks.chat = chatState({
        messages: [
          message("m1", 3, { content: "", media }),
          message("m2", 2, { content: null, deleted: true, media: [] }),
        ],
      });
      const { container } = renderChat();

      expect(container.querySelectorAll(".community-text")).toHaveLength(0);
      expect(screen.getAllByRole("button", { name: /Open image/ })).toHaveLength(1);
    });

    it("quotes a picture-only message as Photo", () => {
      mocks.chat = chatState({
        messages: [
          message("m1", 3, {
            replyToId: "m0",
            replyTo: {
              id: "m0",
              content: "",
              hasMedia: true,
              deleted: false,
              blocked: false,
              authorName: "Bo",
            },
          }),
        ],
      });
      renderChat();

      expect(screen.getByText("Photo")).toBeInTheDocument();
    });

    it("lets a caption be cleared from a message that has pictures, but not from one without", async () => {
      const media = [{ id: "i1", url: "https://cdn/1.png", width: 10, height: 10 }];
      const chat = chatState({
        messages: [
          message("m1", 3, { content: "caption", media, author: author("me", "Me") }),
          message("m2", 2, { content: "plain", author: author("me", "Me") }),
        ],
      });
      mocks.chat = chat;
      const { container } = renderChat();
      const startEdit = (id) => {
        const row = container.querySelector(`#community-message-${id}`);
        fireEvent.click(within(row).getByRole("button", { name: "More" }));
        fireEvent.click(screen.getByRole("menuitem", { name: /Edit/ }));
        return screen.getByRole("textbox", { name: "Edit message" });
      };

      fireEvent.change(startEdit("m1"), { target: { value: "" } });
      expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() =>
        expect(chat.edit.mutateAsync).toHaveBeenCalledWith({ messageId: "m1", content: "" }),
      );

      fireEvent.change(startEdit("m2"), { target: { value: "" } });
      expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    });

    it("shows pictures that are still going out", () => {
      mocks.chat = chatState({
        pending: [
          {
            clientId: "k1",
            content: "",
            files: [png("out.png")],
            replyTo: null,
            status: "sending",
            error: null,
            createdAt: at(0),
          },
        ],
      });
      const { container } = renderChat();

      expect(container.querySelectorAll(".community-message.pending .community-media")).toHaveLength(1);
      expect(screen.getByText("Sending...")).toBeInTheDocument();
    });
  });

  describe("mentions", () => {
    const members = [
      { id: "u1", name: "Bobby", username: "bobby", image: null },
      { id: "u2", name: "Bonnie", username: "bonnie", image: null },
    ];
    const typeAt = (text) => {
      const box = composer();
      fireEvent.change(box, { target: { value: text, selectionStart: text.length } });
      box.setSelectionRange(text.length, text.length);
      fireEvent.select(box);
    };

    it("shows the handles that pinged someone as mentions, and leaves other @words plain", () => {
      mocks.chat = chatState({
        messages: [message("m1", 2, { content: "hi @bobby and @nobody", mentions: ["bobby"] })],
      });
      const { container } = renderChat();

      const spans = container.querySelectorAll(".community-text .mention");
      expect(spans).toHaveLength(1);
      expect(spans[0]).toHaveTextContent("@bobby");
    });

    it("makes a message that names you stand out, and not the others", () => {
      mocks.user = { id: "me", name: "Me", image: null, username: "Me-Handle" };
      mocks.chat = chatState({
        messages: [
          message("m1", 3, { content: "@me-handle look", mentions: ["me-handle"] }),
          message("m2", 2, { content: "@bobby look", mentions: ["bobby"] }),
        ],
      });
      const { container } = renderChat();

      expect(container.querySelector("#community-message-m1")).toHaveClass("mentions-me");
      expect(container.querySelector("#community-message-m2")).not.toHaveClass("mentions-me");
    });

    it("suggests members as soon as an @ is typed, narrowing as you type", () => {
      mocks.suggestions = members;
      renderChat();

      typeAt("hi @");
      expect(screen.getByRole("listbox", { name: "Suggested members" })).toBeInTheDocument();
      expect(screen.getAllByRole("option")).toHaveLength(2);

      typeAt("hi @bob");
      expect(screen.getAllByRole("option")).toHaveLength(1);
      expect(screen.getByText("@bobby")).toBeInTheDocument();
    });

    it("suggests nothing for text with no @ or for an email", () => {
      mocks.suggestions = members;
      renderChat();

      typeAt("just words");
      typeAt("mail bob@bo");

      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    });

    it("puts the picked member's handle into the text, and does not send on that Enter", () => {
      mocks.suggestions = members;
      const chat = chatState();
      mocks.chat = chat;
      renderChat();
      typeAt("hi @bo");

      fireEvent.keyDown(composer(), { key: "ArrowDown" });
      fireEvent.keyDown(composer(), { key: "Enter" });

      expect(composer()).toHaveValue("hi @bonnie ");
      expect(chat.send).not.toHaveBeenCalled();
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    });

    it("picks with a click, too, and with Tab", () => {
      mocks.suggestions = members;
      renderChat();
      typeAt("@bo");

      fireEvent.mouseDown(screen.getByRole("option", { name: /Bonnie/ }));
      expect(composer()).toHaveValue("@bonnie ");

      typeAt("hey @bob");
      fireEvent.keyDown(composer(), { key: "Tab" });
      expect(composer()).toHaveValue("hey @bobby ");
    });

    it("closes the list with Escape, and sends normally on the next Enter", () => {
      mocks.suggestions = members;
      const chat = chatState();
      mocks.chat = chat;
      renderChat();
      typeAt("hi @bo");

      fireEvent.keyDown(composer(), { key: "Escape" });
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
      fireEvent.keyDown(composer(), { key: "Enter" });

      expect(chat.send).toHaveBeenCalledWith("hi @bo", null, []);
    });

    it("still sends on Enter when no list is open", () => {
      const chat = chatState();
      mocks.chat = chat;
      renderChat();

      type("plain");
      enter();

      expect(chat.send).toHaveBeenCalledWith("plain", null, []);
    });
  });

  describe("messages going out", () => {
    const entry = (extra = {}) => ({
      clientId: "k1",
      content: "on its way",
      replyTo: null,
      status: "sending",
      error: null,
      createdAt: at(0),
      ...extra,
    });

    it("shows a message that is still sending", () => {
      mocks.chat = chatState({ pending: [entry()] });

      renderChat();

      expect(screen.getByText("on its way")).toBeInTheDocument();
      expect(screen.getByText("Sending...")).toBeInTheDocument();
    });

    it("offers to retry or discard one that failed", () => {
      const chat = chatState({ pending: [entry({ status: "failed", error: "Network down" })] });
      mocks.chat = chat;
      renderChat();

      expect(screen.getByRole("alert")).toHaveTextContent("Network down");
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
      fireEvent.click(screen.getByRole("button", { name: "Discard" }));

      expect(chat.retry).toHaveBeenCalledWith("k1");
      expect(chat.discard).toHaveBeenCalledWith("k1");
    });
  });

  describe("removing and editing", () => {
    const openMore = (row) => fireEvent.click(within(row).getByRole("button", { name: "More" }));
    const rowOf = (text) => screen.getByText(text).closest(".community-message");

    it("lets you remove your own message after confirming", () => {
      const chat = chatState({ messages: [message("m1", 2, { author: author("me", "Me") })] });
      mocks.chat = chat;
      renderChat();

      openMore(rowOf("text m1"));
      fireEvent.click(screen.getByRole("menuitem", { name: /Remove/ }));
      expect(chat.remove.mutate).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "Remove message" }));

      expect(chat.remove.mutate).toHaveBeenCalledWith({ messageId: "m1" }, expect.any(Object));
    });

    it("does not offer to remove someone else's message to a member", () => {
      mocks.chat = chatState({ messages: [message("m1", 2)] });
      renderChat();

      openMore(rowOf("text m1"));

      expect(screen.queryByRole("menuitem", { name: /Remove/ })).not.toBeInTheDocument();
    });

    it("offers a moderator to remove anyone's message", () => {
      mocks.chat = chatState({ canModerate: true, messages: [message("m1", 2)] });
      renderChat();

      openMore(rowOf("text m1"));

      expect(screen.getByRole("menuitem", { name: /Remove/ })).toBeInTheDocument();
    });

    it("edits your own recent message in place", async () => {
      const chat = chatState({ messages: [message("m1", 2, { author: author("me", "Me") })] });
      mocks.chat = chat;
      renderChat();

      openMore(rowOf("text m1"));
      fireEvent.click(screen.getByRole("menuitem", { name: /Edit/ }));
      fireEvent.change(screen.getByRole("textbox", { name: "Edit message" }), {
        target: { value: "fixed" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));

      await waitFor(() =>
        expect(chat.edit.mutateAsync).toHaveBeenCalledWith({ messageId: "m1", content: "fixed" }),
      );
      await waitFor(() =>
        expect(screen.queryByRole("textbox", { name: "Edit message" })).not.toBeInTheDocument(),
      );
    });

    it("does not offer to edit a message older than 15 minutes", () => {
      mocks.chat = chatState({ messages: [message("m1", 20, { author: author("me", "Me") })] });
      renderChat();

      openMore(rowOf("text m1"));

      expect(screen.queryByRole("menuitem", { name: /Edit/ })).not.toBeInTheDocument();
    });

    it("keeps the edit box open with the error when saving fails", async () => {
      const chat = chatState({ messages: [message("m1", 2, { author: author("me", "Me") })] });
      chat.edit.mutateAsync.mockRejectedValue(new Error("Too late"));
      chat.edit.error = new Error("Too late");
      mocks.chat = chat;
      renderChat();

      openMore(rowOf("text m1"));
      fireEvent.click(screen.getByRole("menuitem", { name: /Edit/ }));
      fireEvent.change(screen.getByRole("textbox", { name: "Edit message" }), {
        target: { value: "fixed" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));

      await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Too late"));
      expect(screen.getByRole("textbox", { name: "Edit message" })).toBeInTheDocument();
    });
  });
});
