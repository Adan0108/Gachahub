import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConversationSearchView } from "../components/chat/ConversationSearchView";

const mocks = vi.hoisted(() => ({ state: { index: null, status: "ready", version: 0 } }));
vi.mock("../hooks/chat/useMessageSearchIndex", () => ({ useMessageSearchIndex: () => mocks.state }));

/** A stand-in for the index: it only has to hold messages and answer search(). */
function fakeIndex() {
  const messages = [];
  return {
    add: ({ messageId, conversationId, envelope }) => messages.push({ messageId, conversationId, text: envelope.body }),
    search: (query, { conversationId } = {}) => {
      const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
      const hits = messages.filter(
        (entry) =>
          (!conversationId || entry.conversationId === conversationId) &&
          terms.every((term) => entry.text.toLowerCase().includes(term)),
      );
      return { terms, hits };
    },
  };
}

const saved = (messageId, body, conversationId = "c1") => ({
  messageId,
  conversationId,
  senderDeviceId: "d1",
  epoch: 1,
  envelope: { v: 1, type: "text", body },
});

const message = (id, createdAt, extra = {}) => ({ id, senderId: "peer", createdAt, status: "SENT", ...extra });

const conversation = {
  id: "c1",
  type: "DIRECT",
  participants: [
    { userId: "me", state: "ACTIVE", user: { id: "me", name: "Me" } },
    { userId: "peer", state: "ACTIVE", user: { id: "peer", name: "Mado" } },
  ],
};

const NOW = Date.now();
const iso = (minutesAgo) => new Date(NOW - minutesAgo * 60_000).toISOString();

const idleHistory = () => ({
  hasMoreHistory: false,
  isLoadingOlder: false,
  isWaitingOnRateLimit: false,
  rateLimitSecondsLeft: 0,
  historyError: undefined,
  retryHistory: vi.fn(),
  loadOlderMessages: vi.fn(),
});

const allLoaded = () =>
  new Map([
    ["m1", message("m1", iso(30))],
    ["m2", message("m2", iso(10), { senderId: "me" })],
    ["m3", message("m3", iso(5))],
  ]);

function setup(overrides = {}) {
  const index = fakeIndex();
  index.add(saved("m1", "pizza tonight?"));
  index.add(saved("m2", "yes, PIZZA please"));
  index.add(saved("m3", "no thanks"));
  index.add(saved("other", "pizza elsewhere", "c2"));
  mocks.state = { index, status: "ready", version: 1 };

  const props = {
    conversation,
    userId: "me",
    messagesById: allLoaded(),
    hiddenMessageIds: new Set(),
    onJump: vi.fn(),
    ...overrides,
    history: { ...idleHistory(), ...overrides.history },
  };
  const view = render(<ConversationSearchView {...props} />);
  // A later render of the same view with some props changed, like the page re-rendering as history loads.
  let current = props;
  const update = (next = {}) => {
    current = { ...current, ...next, history: { ...current.history, ...next.history } };
    view.rerender(<ConversationSearchView {...current} />);
  };
  return { ...props, update };
}

const searchBox = () => screen.getByRole("textbox", { name: "Search this conversation" });
const type = (text) => fireEvent.change(searchBox(), { target: { value: text } });
const search = (text) => {
  type(text);
  fireEvent.keyDown(searchBox(), { key: "Enter" });
};
const rows = () => screen.getAllByRole("button").filter((button) => button.classList.contains("chat-search-result"));
const olderOnly = () => ({
  history: { hasMoreHistory: true },
  messagesById: new Map([["m2", message("m2", iso(10))]]),
});

describe("ConversationSearchView", () => {
  beforeEach(() => {
    mocks.state = { index: fakeIndex(), status: "ready", version: 0 };
  });

  it("shows no message before anything is typed", () => {
    setup();

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("asks for a little more when the text is too short", () => {
    setup();
    type("p");
    expect(screen.getByRole("status")).toHaveTextContent("Type at least 2 letters, then press Enter.");

    fireEvent.keyDown(searchBox(), { key: "Enter" });

    expect(screen.getByRole("status")).toHaveTextContent("Type at least 2 letters.");
  });

  it("does not search while typing, only on Enter", () => {
    setup();

    type("pizza");

    expect(screen.queryAllByRole("button").filter((b) => b.classList.contains("chat-search-result"))).toHaveLength(0);
    expect(screen.getByRole("status")).toHaveTextContent("Press Enter to search.");

    fireEvent.keyDown(searchBox(), { key: "Enter" });

    expect(rows()).toHaveLength(2);
  });

  it("keeps the old results, dimmed, until Enter is pressed for the new text", () => {
    setup();
    search("pizza");

    type("tonight");

    expect(rows()).toHaveLength(2);
    expect(rows()[0].closest("ul")).toHaveClass("stale");
    expect(screen.getByRole("status")).toHaveTextContent("Press Enter to search.");

    fireEvent.keyDown(searchBox(), { key: "Enter" });

    expect(rows()).toHaveLength(1);
    expect(rows()[0].closest("ul")).not.toHaveClass("stale");
  });

  it("clears the results when the box is emptied", () => {
    setup();
    search("pizza");

    type("");

    expect(screen.queryAllByRole("button").filter((b) => b.classList.contains("chat-search-result"))).toHaveLength(0);
  });

  it("shows how far indexing has got", () => {
    setup();
    mocks.state = { ...mocks.state, status: "indexing", indexed: 250, total: 1000 };
    search("pizza");

    expect(screen.getByRole("status")).toHaveTextContent("Indexing messages on this device (25%)...");
  });

  it("shows results a page at a time and opens the list up to a result you step to", () => {
    const index = fakeIndex();
    const messagesById = new Map();
    for (let i = 0; i < 70; i += 1) {
      index.add(saved(`p${i}`, `pizza number ${i}`));
      messagesById.set(`p${i}`, message(`p${i}`, iso(i)));
    }
    const { onJump } = setup({ messagesById });
    mocks.state = { index, status: "ready", version: 2 };

    search("pizza");

    expect(rows()).toHaveLength(30);
    expect(screen.getByRole("status")).toHaveTextContent("70 results");

    fireEvent.click(screen.getByRole("button", { name: "Show more results" }));
    expect(rows()).toHaveLength(60);

    fireEvent.click(screen.getByRole("button", { name: "Show more results" }));
    expect(rows()).toHaveLength(70);
    expect(screen.queryByRole("button", { name: "Show more results" })).not.toBeInTheDocument();

    expect(onJump).not.toHaveBeenCalled();
  });

  it("steps past the shown page when using the arrows", () => {
    const index = fakeIndex();
    const messagesById = new Map();
    for (let i = 0; i < 40; i += 1) {
      index.add(saved(`p${i}`, `pizza number ${i}`));
      messagesById.set(`p${i}`, message(`p${i}`, iso(i)));
    }
    const { onJump } = setup({ messagesById });
    mocks.state = { index, status: "ready", version: 2 };
    search("pizza");

    fireEvent.click(screen.getByRole("button", { name: "Previous result" }));

    expect(onJump).toHaveBeenCalledWith("p39");
    expect(rows()).toHaveLength(40);
  });

  it("lists matches in this conversation only, newest first, who sent them, with the match marked", () => {
    setup();
    search("pizza");

    const found = rows();
    expect(found).toHaveLength(2);
    expect(found[0]).toHaveTextContent("You");
    expect(found[0]).toHaveTextContent("yes, PIZZA please");
    expect(found[1]).toHaveTextContent("Mado");
    expect(found[0].querySelector("mark")).toHaveTextContent("PIZZA");
    expect(screen.getByRole("status")).toHaveTextContent("2 results");
  });

  it("says when nothing matches", () => {
    setup();
    search("zebra");

    expect(screen.getByRole("status")).toHaveTextContent("No messages match.");
  });

  it("says it is still indexing until the index is ready", () => {
    setup();
    mocks.state = { ...mocks.state, status: "indexing" };
    search("pizza");

    expect(screen.getByRole("status")).toHaveTextContent("Indexing messages on this device...");
  });

  it("leaves out unsent messages and ones hidden for you", () => {
    setup({
      messagesById: new Map([
        ["m1", message("m1", iso(30), { status: "DELETED" })],
        ["m2", message("m2", iso(10))],
      ]),
      hiddenMessageIds: new Set(["m2"]),
    });
    search("pizza");

    expect(screen.getByRole("status")).toHaveTextContent("No messages match.");
  });

  it("jumps to a result when it is clicked", () => {
    const { onJump } = setup();
    search("pizza");

    fireEvent.click(rows()[1]);

    expect(onJump).toHaveBeenCalledWith("m1");
    expect(rows()[1]).toHaveClass("active");
    expect(screen.getByRole("status")).toHaveTextContent("2 of 2 results");
  });

  it("steps through results with Enter, Shift+Enter and the arrows, wrapping around", () => {
    const { onJump } = setup();
    search("pizza");

    fireEvent.keyDown(searchBox(), { key: "Enter" });
    fireEvent.keyDown(searchBox(), { key: "Enter" });
    fireEvent.keyDown(searchBox(), { key: "Enter" });
    fireEvent.keyDown(searchBox(), { key: "Enter", shiftKey: true });
    fireEvent.click(screen.getByRole("button", { name: "Next result" }));
    fireEvent.click(screen.getByRole("button", { name: "Previous result" }));

    expect(onJump.mock.calls.map(([id]) => id)).toEqual(["m2", "m1", "m2", "m1", "m2", "m1"]);
  });

  it("disables the arrows while there are no results", () => {
    setup();
    search("zebra");

    expect(screen.getByRole("button", { name: "Next result" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Previous result" })).toBeDisabled();
  });

  it("does not offer older messages when everything is loaded", () => {
    setup();
    search("pizza");

    expect(screen.queryByRole("button", { name: "Load older messages" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show older matches" })).not.toBeInTheDocument();
  });

  it("starts with the text passed in", () => {
    setup({ initialQuery: "pizza" });

    expect(searchBox()).toHaveValue("pizza");
    expect(rows()).toHaveLength(2);
  });

  it("loads one more page at a time when there is nothing known to reach", () => {
    const { history } = setup({ history: { hasMoreHistory: true } });
    search("zebra");

    fireEvent.click(screen.getByRole("button", { name: "Load older messages" }));

    expect(history.loadOlderMessages).toHaveBeenCalledTimes(1);
  });
});

describe("ConversationSearchView loading older messages to reach matches", () => {
  it("counts matches waiting in older messages and offers to show them", () => {
    const { history } = setup(olderOnly());
    search("pizza");

    expect(screen.getByText("1 match in older messages.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show older matches" })).toBeInTheDocument();
    expect(history.loadOlderMessages).not.toHaveBeenCalled();
  });

  it("keeps loading pages after Show older matches until they are all in the thread", () => {
    const { history, update } = setup(olderOnly());
    search("pizza");

    fireEvent.click(screen.getByRole("button", { name: "Show older matches" }));

    expect(history.loadOlderMessages).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Loading older messages... 1 match to reach")).toBeInTheDocument();

    update({ history: { isLoadingOlder: true } });
    update({ history: { isLoadingOlder: false } });
    expect(history.loadOlderMessages).toHaveBeenCalledTimes(2);

    update({ messagesById: allLoaded() });
    expect(history.loadOlderMessages).toHaveBeenCalledTimes(2);
    expect(rows()).toHaveLength(2);
  });

  it("stops when told to", () => {
    const { history, update } = setup(olderOnly());
    search("pizza");
    fireEvent.click(screen.getByRole("button", { name: "Show older matches" }));

    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    update({ history: { isLoadingOlder: true } });
    update({ history: { isLoadingOlder: false } });

    expect(history.loadOlderMessages).toHaveBeenCalledTimes(1);
  });

  it("stops at the end of the history even if matches are still unaccounted for", () => {
    const { history, update } = setup(olderOnly());
    search("pizza");
    fireEvent.click(screen.getByRole("button", { name: "Show older matches" }));

    update({ history: { hasMoreHistory: false } });

    expect(history.loadOlderMessages).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Stop" })).not.toBeInTheDocument();
  });

  it("waits out a rate limit, and carries on when it ends", () => {
    const { history, update } = setup(olderOnly());
    search("pizza");
    fireEvent.click(screen.getByRole("button", { name: "Show older matches" }));

    update({ history: { isWaitingOnRateLimit: true, rateLimitSecondsLeft: 6 } });
    expect(screen.getByText("Slowed down, resuming in 6s...")).toBeInTheDocument();
    expect(history.loadOlderMessages).toHaveBeenCalledTimes(1);

    update({ history: { isWaitingOnRateLimit: false, rateLimitSecondsLeft: 0 } });
    expect(history.loadOlderMessages).toHaveBeenCalledTimes(2);
  });

  it("shows a failure with Retry and does not keep hammering the server", () => {
    const { history, update } = setup(olderOnly());
    search("pizza");
    fireEvent.click(screen.getByRole("button", { name: "Show older matches" }));

    update({ history: { historyError: new Error("boom") } });
    update({ history: { historyError: new Error("boom") } });

    expect(screen.getByText("Couldn't load older messages.")).toBeInTheDocument();
    expect(history.loadOlderMessages).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(history.retryHistory).toHaveBeenCalledTimes(1);
  });
});

describe("ConversationSearchView landing on a message from the sidebar", () => {
  const withTarget = (extra = {}) => ({
    initialQuery: "pizza",
    targetMessageId: "m1",
    history: { hasMoreHistory: true },
    messagesById: new Map([["m2", message("m2", iso(10))]]),
    ...extra,
  });

  it("loads older messages on its own until the message is in the thread", () => {
    const { history, onJump } = setup(withTarget());

    expect(history.loadOlderMessages).toHaveBeenCalledTimes(1);
    expect(onJump).not.toHaveBeenCalled();
  });

  it("jumps to it once, and highlights it, as soon as it arrives", () => {
    const { onJump, history, update } = setup(withTarget());

    update({ messagesById: allLoaded() });
    update({ history: { isLoadingOlder: true } });

    expect(onJump).toHaveBeenCalledTimes(1);
    expect(onJump).toHaveBeenCalledWith("m1");
    expect(rows().find((row) => row.classList.contains("active"))).toHaveTextContent("pizza tonight?");
    expect(history.loadOlderMessages).toHaveBeenCalledTimes(1);
  });

  it("jumps straight away when the message is already loaded", () => {
    const { onJump, history } = setup(withTarget({ messagesById: allLoaded() }));

    expect(onJump).toHaveBeenCalledWith("m1");
    expect(history.loadOlderMessages).not.toHaveBeenCalled();
  });

  it("lets go of the target once the search text is edited", () => {
    const { history, onJump, update } = setup(withTarget());
    search("pizz");

    update({ history: { isLoadingOlder: true } });
    update({ history: { isLoadingOlder: false } });
    update({ messagesById: new Map([["m1", message("m1", iso(30))]]) });

    expect(history.loadOlderMessages).toHaveBeenCalledTimes(1);
    expect(onJump).not.toHaveBeenCalled();
  });
});
