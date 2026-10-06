import "@testing-library/jest-dom/vitest";
import { render, renderHook, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MessageStatusLine } from "../components/chat/MessageStatusLine";
import { ThreadRow } from "../components/chat/ThreadRow";
import { useReceiptDisplay } from "../hooks/chat/useReceiptDisplay";

const READ = "2026-10-06T10:05:00.000Z";
const person = (id, name) => ({ userId: id, state: "ACTIVE", user: { id, name, image: null } });
const dm = { id: "c1", type: "DIRECT", participants: [person("me", "Me"), person("bob", "Bob")] };
const group = {
  id: "g1",
  type: "GROUP",
  participants: [person("me", "Me"), person("ann", "Ann"), person("bob", "Bob")],
};
const mine = (id, receipts = []) => ({ id, senderId: "me", createdAt: READ, contentType: "TEXT", status: "SENT", receipts });
const theirs = (id) => ({ id, senderId: "bob", createdAt: READ, contentType: "TEXT", status: "SENT", receipts: [] });

describe("MessageStatusLine", () => {
  it.each([
    ["sent", "Sent"],
    ["delivered", "Delivered"],
    ["seen", "Seen"],
  ])("says %s as %s", (status, label) => {
    render(<MessageStatusLine status={status} />);

    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it("shows nothing when there is nothing to say", () => {
    const { container } = render(<MessageStatusLine />);

    expect(container).toBeEmptyDOMElement();
  });

  it("shows who has read up to there, named for anyone using a screen reader", () => {
    render(
      <MessageStatusLine
        readers={[
          { id: "ann", name: "Ann", image: null },
          { id: "bob", name: "Bob", image: null },
        ]}
      />,
    );

    expect(screen.getByRole("img", { name: "Seen by Ann, Bob" })).toBeInTheDocument();
    expect(screen.queryByText("Seen")).not.toBeInTheDocument();
  });

  it("can show readers and a status together", () => {
    render(<MessageStatusLine readers={[{ id: "ann", name: "Ann", image: null }]} status="delivered" />);

    expect(screen.getByRole("img", { name: "Seen by Ann" })).toBeInTheDocument();
    expect(screen.getByText("Delivered")).toBeInTheDocument();
  });
});

describe("useReceiptDisplay", () => {
  const run = (overrides) =>
    renderHook(() =>
      useReceiptDisplay({
        messages: [mine("m1", [{ userId: "bob", delivered: true, readAt: READ }])],
        hiddenMessageIds: new Set(),
        userId: "me",
        conversation: dm,
        peerId: "bob",
        hasPending: false,
        ...overrides,
      }),
    ).result.current;

  it("works out the status of your last message from the peer in a direct chat", () => {
    expect(run().statusFor.get("m1")).toBe("seen");
  });

  it("uses the active members in a group", () => {
    const info = run({
      conversation: group,
      peerId: undefined,
      messages: [mine("m1", [{ userId: "ann", delivered: true, readAt: READ }])],
    });

    expect(info.readersAt.get("m1")).toEqual(["ann"]);
  });

  it("skips messages you hid for yourself", () => {
    const info = run({
      messages: [mine("m1"), mine("m2")],
      hiddenMessageIds: new Set(["m2"]),
    });

    expect([...info.statusFor.keys()]).toEqual(["m1"]);
  });

  it("holds back the status while a message is still sending below, but keeps the readers", () => {
    const info = run({
      conversation: group,
      peerId: undefined,
      messages: [mine("m1", [{ userId: "ann", delivered: true, readAt: READ }])],
      hasPending: true,
    });

    expect(info.statusFor.size).toBe(0);
    expect(info.readersAt.get("m1")).toEqual(["ann"]);
  });
});

describe("ThreadRow receipts", () => {
  function renderRow({ message, conversation = dm, receiptInfo }) {
    render(
      <ThreadRow
        conversation={conversation}
        decryptedById={{ [message.id]: { status: "ok", envelope: { v: 1, type: "text", body: "hello" } } }}
        item={{ kind: "message", message, index: 0, gapBefore: false, groupedWithPrevious: false, groupedWithNext: false }}
        messagesById={new Map([[message.id, message]])}
        neighbors={[]}
        now={Date.parse(READ)}
        onCopy={vi.fn()}
        onEdit={vi.fn()}
        onJumpToMessage={vi.fn()}
        onReact={vi.fn()}
        onRemove={vi.fn()}
        onReply={vi.fn()}
        receiptInfo={receiptInfo}
        userId="me"
      />,
    );
  }
  const info = (statusFor = [], readersAt = []) => ({ statusFor: new Map(statusFor), readersAt: new Map(readersAt) });

  it("shows the status under your message", () => {
    renderRow({ message: mine("m1"), receiptInfo: info([["m1", "delivered"]]) });

    expect(screen.getByText("Delivered")).toBeInTheDocument();
  });

  it("shows readers under the message they last read", () => {
    renderRow({ message: mine("m1"), conversation: group, receiptInfo: info([], [["m1", ["ann"]]]) });

    expect(screen.getByRole("img", { name: "Seen by Ann" })).toBeInTheDocument();
  });

  it("shows nothing under a message that has no status", () => {
    renderRow({ message: mine("m1"), receiptInfo: info([["other", "sent"]]) });

    expect(screen.queryByText("Sent")).not.toBeInTheDocument();
  });

  it("never shows a status under someone else's message", () => {
    renderRow({ message: theirs("m1"), receiptInfo: info([["m1", "seen"]], [["m1", ["ann"]]]) });

    expect(screen.queryByText("Seen")).not.toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /Seen by/ })).not.toBeInTheDocument();
  });

  it("copes with no receipt information at all", () => {
    renderRow({ message: mine("m1") });

    expect(screen.queryByText("Sent")).not.toBeInTheDocument();
  });
});
