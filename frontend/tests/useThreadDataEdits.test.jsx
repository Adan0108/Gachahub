import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useThreadData } from "../hooks/chat/useThreadData";

const mocks = vi.hoisted(() => ({
  history: { displayMessages: [] },
  decrypted: {},
  decryptCalls: [],
  announcedFor: [],
}));

vi.mock("../hooks/chat/useConversationHistory", () => ({ useConversationHistory: () => mocks.history }));
vi.mock("../hooks/chat/useDecryptedMessages", () => ({
  useDecryptedMessages: (...args) => {
    mocks.decryptCalls.push(args);
    return mocks.decrypted;
  },
}));
vi.mock("../hooks/chat/useGroupProblem", () => ({ useGroupProblem: () => null }));
vi.mock("../hooks/chat/useMembershipEvents", () => ({ useMembershipEvents: () => [] }));
vi.mock("../hooks/chat/useSafetyNumbers", () => ({ useSafetyNumbers: () => ({ byUser: {} }) }));
vi.mock("../hooks/chat/useNewMessageAnnouncement", () => ({
  useNewMessageAnnouncement: (conversationId, lastMessage) => {
    mocks.announcedFor.push(lastMessage?.id);
    return { seq: 0, text: "" };
  },
}));
vi.mock("../hooks/useNowTick", () => ({ useNowTick: () => 0 }));

const T0 = Date.parse("2026-10-05T12:00:00.000Z");
const at = (minutes) => new Date(T0 + minutes * 60_000).toISOString();
const row = (id, minutes, extra = {}) => ({
  id,
  senderId: "alice",
  createdAt: at(minutes),
  contentType: "TEXT",
  status: "SENT",
  ciphertext: "x",
  ...extra,
});
const editRow = (id, target, minutes) => row(id, minutes, { contentType: "EDIT", editsMessageId: target });
const text = (body) => ({ status: "ok", envelope: { v: 1, type: "text", body } });
const edit = (target, body) => ({
  status: "ok",
  envelope: { v: 1, type: "edit", body: { targetMessageId: target, text: body, n: 1 } },
});

function render(newestPage) {
  return renderHook(() => useThreadData("c1", newestPage, { type: "DIRECT", participants: [] }, "bob")).result.current;
}

describe("useThreadData with edits", () => {
  beforeEach(() => {
    mocks.history = { displayMessages: [] };
    mocks.decrypted = {};
    mocks.decryptCalls = [];
    mocks.announcedFor = [];
  });

  const withEdit = () => {
    mocks.history = {
      displayMessages: [row("m1", 0), row("m2", 1, { senderId: "bob" }), editRow("e1", "m1", 3)],
    };
    mocks.decrypted = { m1: text("hello"), m2: text("hi"), e1: edit("m1", "hello there") };
  };

  it("shows the edited text on the original message", () => {
    withEdit();

    const thread = render({ items: mocks.history.displayMessages, meta: {} });

    expect(thread.decrypted.m1.envelope.body).toBe("hello there");
    expect(thread.decrypted.m2.envelope.body).toBe("hi");
    expect(thread.edited.get("m1").versions.map((version) => version.text)).toEqual(["hello", "hello there"]);
  });

  it("never shows the hidden edit as a message of its own", () => {
    withEdit();

    const thread = render({ items: mocks.history.displayMessages, meta: {} });

    expect(thread.displayMessages.map((message) => message.id)).toEqual(["m1", "m2"]);
    expect(thread.messagesById.has("e1")).toBe(false);
    const shown = thread.threadItems.filter((item) => item.kind === "message").map((item) => item.message.id);
    expect(shown).toEqual(["m1", "m2"]);
  });

  it("still decrypts the hidden edits, since the text only arrives that way", () => {
    withEdit();

    render({ items: mocks.history.displayMessages, meta: {} });

    expect(mocks.decryptCalls[0][1].map((message) => message.id)).toContain("e1");
  });

  it("does not mark a hidden edit as something to read", () => {
    withEdit();
    mocks.history.displayMessages.push(editRow("e2", "m1", 4));
    mocks.decrypted.e2 = edit("m1", "again");

    const thread = render({ items: mocks.history.displayMessages, meta: {} });

    expect(thread.readableMessageIds).toEqual(["m1"]);
  });

  it("announces the last message you can see, not a hidden edit after it", () => {
    withEdit();

    render({ items: mocks.history.displayMessages, meta: {} });

    expect(mocks.announcedFor.at(-1)).toBe("m2");
  });

  it("drops the cached text of a message's edits when the message is unsent", () => {
    mocks.history = {
      displayMessages: [row("m1", 0, { status: "DELETED" }), editRow("e1", "m1", 1), row("m2", 2)],
    };
    mocks.decrypted = { m2: text("hi") };

    render({ items: mocks.history.displayMessages, meta: {} });

    expect(mocks.decryptCalls[0][3].sort()).toEqual(["e1", "m1"]);
  });

  it("leaves other messages' edits alone when one message is unsent", () => {
    mocks.history = {
      displayMessages: [row("m1", 0, { status: "DELETED" }), row("m2", 1), editRow("e2", "m2", 2)],
    };

    render({ items: mocks.history.displayMessages, meta: {} });

    expect(mocks.decryptCalls[0][3]).toEqual(["m1"]);
  });
});
