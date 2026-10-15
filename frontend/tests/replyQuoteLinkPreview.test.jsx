import "@testing-library/jest-dom/vitest";
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ThreadRow } from "../components/chat/ThreadRow";

const mocks = vi.hoisted(() => ({ useAttachmentBlobUrl: vi.fn() }));

vi.mock("../hooks/chat/useAttachmentBlobUrl", () => ({ useAttachmentBlobUrl: mocks.useAttachmentBlobUrl }));

const SENT = "2026-10-06T10:05:00.000Z";
const b64 = (bytes) => Buffer.alloc(bytes, 7).toString("base64");
const THUMB = { blob: "upload-1", key: b64(32), iv: b64(12), sha256: b64(32), width: 320, height: 180 };
const LINK = "https://www.youtube.com/watch?v=abc123";

const person = (id, name) => ({ userId: id, state: "ACTIVE", user: { id, name, image: null } });
const dm = { id: "c1", type: "DIRECT", participants: [person("me", "Me"), person("bob", "Bob")] };

const original = {
  id: "m1",
  senderId: "bob",
  createdAt: SENT,
  contentType: "TEXT",
  status: "SENT",
  receipts: [],
  media: [{ mediaUploadId: "upload-1", url: "https://cdn.example/thumb" }],
};
const reply = { id: "m2", senderId: "me", createdAt: SENT, contentType: "TEXT", status: "SENT", receipts: [], replyToId: "m1" };

const withCard = (extra = {}) => ({
  status: "ok",
  envelope: {
    v: 1,
    type: "text",
    body: `look ${LINK}`,
    previews: [{ url: LINK, title: "A great video", thumb: THUMB }],
    ...extra,
  },
});
const plain = (body) => ({ status: "ok", envelope: { v: 1, type: "text", body } });

function renderReply(quoted) {
  return render(
    <ThreadRow
      conversation={dm}
      decryptedById={{ m1: quoted, m2: plain("test") }}
      item={{ kind: "message", message: reply, index: 0, gapBefore: false, groupedWithPrevious: false, groupedWithNext: false }}
      messagesById={new Map([["m1", original], ["m2", reply]])}
      neighbors={[]}
      now={Date.parse(SENT)}
      onCopy={vi.fn()}
      onEdit={vi.fn()}
      onJumpToMessage={vi.fn()}
      onReact={vi.fn()}
      onRemove={vi.fn()}
      onReply={vi.fn()}
      receiptInfo={undefined}
      userId="me"
    />,
  );
}

describe("a reply to a message with a link preview", () => {
  beforeEach(() => {
    mocks.useAttachmentBlobUrl.mockReset().mockReturnValue({ status: "ready", url: "blob:decrypted" });
  });

  it("keeps the picture and title of the quoted card in the quote", () => {
    const { container } = renderReply(withCard());

    const quote = container.querySelector(".chat-reply-quote");
    expect(quote.querySelector(".chat-reply-quote-preview img")).toHaveAttribute("src", "blob:decrypted");
    expect(quote).toHaveTextContent("A great video");
  });

  it("still shows the quoted text above it", () => {
    const { container } = renderReply(withCard());

    expect(container.querySelector(".chat-reply-quote-text")).toHaveTextContent(`look ${LINK}`);
  });

  it("loads the picture from the quoted message's attachments, not the reply's", () => {
    renderReply(withCard());

    const [source] = mocks.useAttachmentBlobUrl.mock.calls[0];
    expect(source).toMatchObject({ cacheKey: "m1:link-preview:thumb", url: "https://cdn.example/thumb" });
  });

  it("does not turn the quote into a link: clicking it still jumps to the original", () => {
    const { container } = renderReply(withCard());

    expect(container.querySelector(".chat-reply-quote a")).toBeNull();
  });

  it("is the plain text quote for an original with no card", () => {
    const { container } = renderReply(plain("just words"));

    expect(container.querySelector(".chat-reply-quote-preview")).toBeNull();
    expect(container.querySelector(".chat-reply-quote-text")).toHaveTextContent("just words");
  });

  it("shows no card in the quote once an edit has taken the link out of the original", () => {
    const { container } = renderReply(withCard({ body: "no link now" }));

    expect(container.querySelector(".chat-reply-quote-preview")).toBeNull();
  });

  it("shows no card in the quote for an address that is not in the original's text", () => {
    const { container } = renderReply(withCard({ previews: [{ url: "https://evil.example/login", title: "Log in" }] }));

    expect(container.querySelector(".chat-reply-quote-preview")).toBeNull();
    expect(container).not.toHaveTextContent("Log in");
  });

  it("says a message when the original cannot be read", () => {
    const { container } = renderReply({ status: "unavailable" });

    expect(container.querySelector(".chat-reply-quote")).toHaveTextContent("a message");
  });
});
