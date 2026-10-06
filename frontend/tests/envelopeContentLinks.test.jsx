import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EnvelopeContent, PendingContent } from "../components/chat/EnvelopeContent";

const mocks = vi.hoisted(() => ({ useAttachmentBlobUrl: vi.fn() }));

vi.mock("../hooks/chat/useAttachmentBlobUrl", () => ({ useAttachmentBlobUrl: mocks.useAttachmentBlobUrl }));

const b64 = (bytes) => Buffer.alloc(bytes, 7).toString("base64");
const THUMB = { blob: "upload-1", key: b64(32), iv: b64(12), sha256: b64(32), width: 320, height: 180 };
const URL_IN_TEXT = "https://example.com/post";
const text = `look at ${URL_IN_TEXT} please`;
const media = [{ mediaUploadId: "upload-1", url: "https://cdn.example/thumb" }];

const textEnvelope = (extra = {}, body = text) => ({ v: 1, type: "text", body, ...extra });

describe("EnvelopeContent with links", () => {
  beforeEach(() => {
    mocks.useAttachmentBlobUrl.mockReset().mockReturnValue({ status: "idle" });
  });

  it("makes a link in a text message clickable", () => {
    render(<EnvelopeContent envelope={textEnvelope()} media={[]} messageId="m1" />);

    expect(screen.getByRole("link", { name: URL_IN_TEXT })).toHaveAttribute("href", URL_IN_TEXT);
  });

  it("shows a plain text message as a single paragraph, as before", () => {
    const { container } = render(<EnvelopeContent envelope={textEnvelope({}, "hello")} media={[]} messageId="m1" />);

    expect(container.querySelectorAll("p")).toHaveLength(1);
    expect(container.querySelector(".chat-text-with-preview")).toBeNull();
  });

  it("shows the card under the text when the message has one", () => {
    const envelope = textEnvelope({ previews: [{ url: URL_IN_TEXT, title: "A post", thumb: THUMB }] });

    const { container } = render(<EnvelopeContent envelope={envelope} media={media} messageId="m1" />);

    expect(container.querySelector(".chat-text-with-preview")).not.toBeNull();
    expect(screen.getByText("A post")).toBeInTheDocument();
    expect(screen.getByText("example.com")).toBeInTheDocument();
    expect(screen.getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([URL_IN_TEXT, URL_IN_TEXT]);
  });

  it("shows the decrypted picture in the card", () => {
    mocks.useAttachmentBlobUrl.mockReturnValue({ status: "ready", url: "blob:decrypted" });
    const envelope = textEnvelope({ previews: [{ url: URL_IN_TEXT, title: "A post", thumb: THUMB }] });

    const { container } = render(<EnvelopeContent envelope={envelope} media={media} messageId="m1" />);

    expect(container.querySelector("img")).toHaveAttribute("src", "blob:decrypted");
  });

  it("shows no card for an address that is not in the message", () => {
    const envelope = textEnvelope({ previews: [{ url: "https://evil.example/login", title: "Log in" }] });

    render(<EnvelopeContent envelope={envelope} media={media} messageId="m1" />);

    expect(screen.queryByText("Log in")).not.toBeInTheDocument();
    expect(screen.queryByText("evil.example")).not.toBeInTheDocument();
  });

  it("shows no card once an edit has taken the link out of the message", () => {
    const envelope = textEnvelope({ previews: [{ url: URL_IN_TEXT, title: "A post" }] }, "never mind, no link now");

    render(<EnvelopeContent envelope={envelope} media={media} messageId="m1" />);

    expect(screen.queryByText("A post")).not.toBeInTheDocument();
    expect(screen.getByText("never mind, no link now")).toBeInTheDocument();
  });

  it("shows a hostile card's text as text", () => {
    const envelope = textEnvelope({ previews: [{ url: URL_IN_TEXT, title: "<img src=x onerror=alert(1)>" }] });

    const { container } = render(<EnvelopeContent envelope={envelope} media={media} messageId="m1" />);

    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeInTheDocument();
  });

  it("still says an unknown message type is not supported", () => {
    render(<EnvelopeContent envelope={{ v: 1, type: "mystery", body: "x" }} media={[]} messageId="m1" />);

    expect(screen.getByText(/isn't supported yet/)).toBeInTheDocument();
  });
});

describe("PendingContent with links", () => {
  const preview = {
    url: URL_IN_TEXT,
    domain: "example.com",
    resolvedDomain: null,
    title: "A post",
    description: null,
    image: null,
  };

  it("makes a link in a message that is going out clickable", () => {
    render(<PendingContent text={text} />);

    expect(screen.getByRole("link", { name: URL_IN_TEXT })).toBeInTheDocument();
  });

  it("shows the card on a message that is going out, so it does not appear only after it lands", () => {
    render(<PendingContent preview={preview} text={text} />);

    expect(screen.getByText("A post")).toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(2);
  });

  it("is a single paragraph with no preview, as before", () => {
    const { container } = render(<PendingContent text="hello" />);

    expect(container.querySelectorAll("p")).toHaveLength(1);
    expect(container.querySelector(".chat-text-with-preview")).toBeNull();
  });

  it("shows nothing for no text and no files", () => {
    const { container } = render(<PendingContent text="" />);

    expect(container).toBeEmptyDOMElement();
  });
});
