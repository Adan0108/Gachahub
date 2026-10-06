import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EditedLabel } from "../components/chat/EditedLabel";
import { MessageActions } from "../components/chat/MessageActions";
import { ThreadRow } from "../components/chat/ThreadRow";

const T0 = Date.parse("2026-10-05T12:00:00.000Z");
const minutes = (count) => T0 + count * 60_000;

const actions = (props = {}) => {
  const handlers = {
    onReact: vi.fn(),
    onReply: vi.fn(),
    onCopy: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onDeleteForMe: vi.fn(),
  };
  render(<MessageActions canCopy isMine {...handlers} {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "More" }));
  return handlers;
};

describe("MessageActions edit", () => {
  it("offers Edit when the message can be edited, and runs it", () => {
    const { onEdit } = actions({ canEdit: true });

    fireEvent.click(screen.getByRole("menuitem", { name: /Edit/ }));

    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it("does not offer Edit otherwise", () => {
    actions({ canEdit: false });

    expect(screen.queryByRole("menuitem", { name: /Edit/ })).not.toBeInTheDocument();
  });

  it("does not offer Edit by default", () => {
    actions();

    expect(screen.queryByRole("menuitem", { name: /Edit/ })).not.toBeInTheDocument();
  });
});

describe("EditedLabel", () => {
  const versions = [
    { text: "first", at: minutes(0) },
    { text: "second", at: minutes(2) },
    { text: "third", at: minutes(5) },
  ];

  it("says Edited, with the history closed", () => {
    render(<EditedLabel versions={versions} />);

    expect(screen.getByRole("button", { name: "Edited" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("lists every version newest first on click, marking current and original", () => {
    render(<EditedLabel versions={versions} />);

    fireEvent.click(screen.getByRole("button", { name: "Edited" }));

    const dialog = screen.getByRole("dialog", { name: "Edit history" });
    const items = [...dialog.querySelectorAll("li")];
    expect(items.map((item) => item.querySelector("p").textContent)).toEqual(["third", "second", "first"]);
    expect(items[0]).toHaveTextContent("Current");
    expect(items[1]).toHaveTextContent("Earlier");
    expect(items[2]).toHaveTextContent("Original");
  });

  it("says so when this device never read the original", () => {
    render(
      <EditedLabel
        versions={[
          { text: null, at: minutes(0) },
          { text: "now", at: minutes(1) },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Edited" }));

    expect(screen.getByText("This device never read the original text.")).toBeInTheDocument();
  });

  it("closes again on a second click", () => {
    render(<EditedLabel versions={versions} />);
    const button = screen.getByRole("button", { name: "Edited" });

    fireEvent.click(button);
    fireEvent.click(button);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("ThreadRow with edits", () => {
  const conversation = {
    id: "c1",
    type: "DIRECT",
    participants: [
      { userId: "me", user: { id: "me", name: "Me" } },
      { userId: "peer", user: { id: "peer", name: "Mado" } },
    ],
  };
  const message = (senderId, createdAtMs) => ({
    id: "m1",
    senderId,
    createdAt: new Date(createdAtMs).toISOString(),
    contentType: "TEXT",
    status: "SENT",
    media: [],
    reactions: [],
  });
  const decrypted = { m1: { status: "ok", envelope: { v: 1, type: "text", body: "hello" } } };
  const twoVersions = () =>
    new Map([
      [
        "m1",
        {
          versions: [
            { text: "a", at: T0 },
            { text: "hello", at: minutes(1) },
          ],
        },
      ],
    ]);

  function renderRow({ senderId = "me", sentAt = T0, now = minutes(1), edited, pendingEdits } = {}) {
    const onEdit = vi.fn();
    const onRetryEdit = vi.fn();
    const onDiscardEdit = vi.fn();
    const msg = message(senderId, sentAt);
    render(
      <ThreadRow
        conversation={conversation}
        decryptedById={decrypted}
        edited={edited}
        onDiscardEdit={onDiscardEdit}
        onRetryEdit={onRetryEdit}
        pendingEdits={pendingEdits}
        item={{
          kind: "message",
          message: msg,
          index: 0,
          gapBefore: false,
          groupedWithPrevious: false,
          groupedWithNext: false,
        }}
        messagesById={new Map([["m1", msg]])}
        neighbors={[]}
        now={now}
        onCopy={vi.fn()}
        onDelete={vi.fn()}
        onDeleteForMe={vi.fn()}
        onEdit={onEdit}
        onJumpToMessage={vi.fn()}
        onReact={vi.fn()}
        onReply={vi.fn()}
        userId="me"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    return { onEdit, onRetryEdit, onDiscardEdit };
  }

  describe("while an edit is still being saved", () => {
    const saving = (extra = {}) => new Map([["m1", { text: "hello there", n: 1, clientId: "c", failed: false, ...extra }]]);

    it("shows the new text greyed out, saying it is being edited", () => {
      renderRow({ pendingEdits: saving() });

      expect(screen.getByText("hello there")).toBeInTheDocument();
      expect(screen.queryByText("hello")).not.toBeInTheDocument();
      expect(screen.getByText("hello there").closest("article")).toHaveClass("pending");
      expect(screen.getByText("Editing message...")).toBeInTheDocument();
    });

    it("hides the Edited label and the Edit action until it is saved", () => {
      renderRow({ pendingEdits: saving(), edited: twoVersions() });

      expect(screen.queryByRole("button", { name: "Edited" })).not.toBeInTheDocument();
      expect(screen.queryByRole("menuitem", { name: /Edit/ })).not.toBeInTheDocument();
    });

    it("goes back to a normal message once the edit is no longer pending", () => {
      renderRow({ edited: twoVersions() });

      expect(screen.getByText("hello").closest("article")).not.toHaveClass("pending");
      expect(screen.queryByText("Editing message...")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Edited" })).toBeInTheDocument();
    });

    it("offers retry and discard when saving failed", () => {
      const { onRetryEdit, onDiscardEdit } = renderRow({ pendingEdits: saving({ failed: true }) });

      expect(screen.getByText("hello there").closest("article")).toHaveClass("failed");
      fireEvent.click(screen.getByRole("button", { name: "Failed to edit - tap to retry" }));
      fireEvent.click(screen.getByRole("button", { name: "Discard" }));

      expect(onRetryEdit).toHaveBeenCalledWith("m1");
      expect(onDiscardEdit).toHaveBeenCalledWith("m1");
    });
  });

  it("offers Edit on your own recent text message, with its text and edit count", () => {
    const { onEdit } = renderRow();

    fireEvent.click(screen.getByRole("menuitem", { name: /Edit/ }));

    expect(onEdit).toHaveBeenCalledWith({ id: "m1", text: "hello", editCount: 0 });
  });

  it("counts the edits already made", () => {
    const { onEdit } = renderRow({ edited: twoVersions() });

    fireEvent.click(screen.getByRole("menuitem", { name: /Edit/ }));

    expect(onEdit).toHaveBeenCalledWith({ id: "m1", text: "hello", editCount: 1 });
  });

  it("does not offer Edit on a message from someone else", () => {
    renderRow({ senderId: "peer" });

    expect(screen.queryByRole("menuitem", { name: /Edit/ })).not.toBeInTheDocument();
  });

  it("does not offer Edit once the 15 minutes are up", () => {
    renderRow({ now: minutes(16) });

    expect(screen.queryByRole("menuitem", { name: /Edit/ })).not.toBeInTheDocument();
  });

  it("does not offer Edit after the 10th edit", () => {
    const versions = Array.from({ length: 11 }, (_, i) => ({ text: `v${i}`, at: T0 + i }));
    renderRow({ edited: new Map([["m1", { versions }]]) });

    expect(screen.queryByRole("menuitem", { name: /Edit/ })).not.toBeInTheDocument();
  });

  it("marks an edited message Edited", () => {
    renderRow({ edited: twoVersions() });

    expect(screen.getByRole("button", { name: "Edited" })).toBeInTheDocument();
  });

  it("does not mark an unedited message", () => {
    renderRow();

    expect(screen.queryByRole("button", { name: "Edited" })).not.toBeInTheDocument();
  });
});
