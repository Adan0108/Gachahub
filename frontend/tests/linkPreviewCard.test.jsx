import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DraftLinkPreviewCard,
  LinkPreviewCardView,
  QuotedLinkPreview,
  ReceivedLinkPreviewCard,
} from "../components/chat/LinkPreviewCard";

const mocks = vi.hoisted(() => ({ useAttachmentBlobUrl: vi.fn() }));

vi.mock("../hooks/chat/useAttachmentBlobUrl", () => ({ useAttachmentBlobUrl: mocks.useAttachmentBlobUrl }));

const THUMB = { blob: "upload-1", key: "k", iv: "i", sha256: "s", width: 320, height: 180 };

describe("LinkPreviewCardView", () => {
  it("shows the title and description", () => {
    render(
      <LinkPreviewCardView description="About a thing" domain="example.com" href="https://example.com/a" title="A post" />,
    );

    expect(screen.getByText("A post")).toBeInTheDocument();
    expect(screen.getByText("About a thing")).toBeInTheDocument();
  });

  it("does not name the site for an ordinary link, since the message already shows the address", () => {
    render(<LinkPreviewCardView domain="example.com" href="https://example.com/a" title="A post" />);

    expect(screen.queryByText(/example\.com/)).not.toBeInTheDocument();
  });

  it("names a non-latin site in its xn-- form, where the message's own text could pass for another site", () => {
    render(<LinkPreviewCardView domain="xn--pypal-4ve.com" title="Log in" />);

    expect(screen.getByText("xn--pypal-4ve.com")).toBeInTheDocument();
  });

  it("is a link to the page that opens in a new tab without handing over this one", () => {
    render(<LinkPreviewCardView domain="example.com" href="https://example.com/a" title="A post" />);

    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "https://example.com/a");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer nofollow");
  });

  it("is not a link when it has nowhere to go", () => {
    render(<LinkPreviewCardView domain="example.com" title="A post" />);

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("shows the picture, which is only decoration", () => {
    const { container } = render(
      <LinkPreviewCardView domain="example.com" imageSrc="blob:picture" title="A post" />,
    );

    const image = container.querySelector("img");
    expect(image).toHaveAttribute("src", "blob:picture");
    expect(image).toHaveAttribute("alt", "");
  });

  it("has no picture element when there is no picture", () => {
    const { container } = render(<LinkPreviewCardView domain="example.com" title="A post" />);

    expect(container.querySelector("img")).toBeNull();
  });

  it("shows where a redirecting link really leads", () => {
    render(<LinkPreviewCardView domain="bit.ly" resolvedDomain="destination.example" title="A post" />);

    expect(screen.getByText(/bit\.ly/)).toHaveTextContent("bit.ly → destination.example");
  });

  it("names no site when the link stays on its own site", () => {
    render(<LinkPreviewCardView domain="example.com" resolvedDomain="example.com" title="A post" />);

    expect(screen.queryByText(/example\.com/)).not.toBeInTheDocument();
  });

  it("can be removed when it has a way to be", () => {
    const onDismiss = vi.fn();
    render(<LinkPreviewCardView domain="example.com" onDismiss={onDismiss} title="A post" />);

    fireEvent.click(screen.getByRole("button", { name: "Remove link preview" }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("has no remove button when it cannot be removed", () => {
    render(<LinkPreviewCardView domain="example.com" title="A post" />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows markup in a title as text", () => {
    const { container } = render(
      <LinkPreviewCardView domain="example.com" title="<img src=x onerror=alert(1)>" />,
    );

    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeInTheDocument();
  });
});

describe("ReceivedLinkPreviewCard", () => {
  beforeEach(() => {
    mocks.useAttachmentBlobUrl.mockReset().mockReturnValue({ status: "idle" });
  });

  const media = [{ mediaUploadId: "upload-1", url: "https://cdn.example/thumb" }];

  it("links to the address in the message, whatever the title says", () => {
    render(
      <ReceivedLinkPreviewCard
        media={[]}
        messageId="m1"
        preview={{ url: "https://evil.example/login", title: "PayPal - Log in to your account" }}
      />,
    );

    expect(screen.getByRole("link")).toHaveAttribute("href", "https://evil.example/login");
    expect(screen.queryByText("paypal.com")).not.toBeInTheDocument();
  });

  it("shows a non-latin address in its xn-- form, so it cannot pass for another site", () => {
    render(
      <ReceivedLinkPreviewCard media={[]} messageId="m1" preview={{ url: "https://pаypal.com/", title: "Log in" }} />,
    );

    expect(screen.getByText(/^xn--/)).toBeInTheDocument();
    expect(screen.queryByText("paypal.com")).not.toBeInTheDocument();
  });

  it("links to the address in the message", () => {
    render(
      <ReceivedLinkPreviewCard media={[]} messageId="m1" preview={{ url: "https://example.com/post", title: "A post" }} />,
    );

    expect(screen.getByRole("link")).toHaveAttribute("href", "https://example.com/post");
  });

  it("decrypts the picture from the message's own attachments and shows it once ready", () => {
    mocks.useAttachmentBlobUrl.mockReturnValue({ status: "ready", url: "blob:decrypted" });

    const { container } = render(
      <ReceivedLinkPreviewCard
        media={media}
        messageId="m1"
        preview={{ url: "https://example.com/post", title: "A post", thumb: THUMB }}
      />,
    );

    const [source, enabled] = mocks.useAttachmentBlobUrl.mock.calls[0];
    expect(source).toEqual({
      cacheKey: "m1:link-preview:thumb",
      url: "https://cdn.example/thumb",
      ref: THUMB,
      mime: "image/jpeg",
    });
    expect(enabled).toBe(true);
    expect(container.querySelector("img")).toHaveAttribute("src", "blob:decrypted");
  });

  it.each([["loading"], ["error"], ["idle"]])("shows the card without its picture while it is %s", (status) => {
    mocks.useAttachmentBlobUrl.mockReturnValue({ status });

    const { container } = render(
      <ReceivedLinkPreviewCard
        media={media}
        messageId="m1"
        preview={{ url: "https://example.com/post", title: "A post", thumb: THUMB }}
      />,
    );

    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("A post")).toBeInTheDocument();
  });

  it("does not try to load a picture the message has no attachment for", () => {
    render(
      <ReceivedLinkPreviewCard
        media={[{ mediaUploadId: "someone-elses", url: "https://cdn.example/other" }]}
        messageId="m1"
        preview={{ url: "https://example.com/post", title: "A post", thumb: THUMB }}
      />,
    );

    expect(mocks.useAttachmentBlobUrl.mock.calls[0][0]).toBeNull();
  });

  it("does not try to load a picture a text-only card does not have", () => {
    render(
      <ReceivedLinkPreviewCard media={media} messageId="m1" preview={{ url: "https://example.com/post", title: "A post" }} />,
    );

    expect(mocks.useAttachmentBlobUrl.mock.calls[0][0]).toBeNull();
  });
});

describe("QuotedLinkPreview", () => {
  beforeEach(() => {
    mocks.useAttachmentBlobUrl.mockReset().mockReturnValue({ status: "idle" });
  });

  const media = [{ mediaUploadId: "upload-1", url: "https://cdn.example/thumb" }];
  const preview = { url: "https://example.com/post", title: "A post", thumb: THUMB };

  it("shows the quoted card's picture and title", () => {
    mocks.useAttachmentBlobUrl.mockReturnValue({ status: "ready", url: "blob:decrypted" });

    const { container } = render(<QuotedLinkPreview media={media} messageId="m1" preview={preview} />);

    expect(container.querySelector("img")).toHaveAttribute("src", "blob:decrypted");
    expect(screen.getByText("A post")).toBeInTheDocument();
  });

  it("loads the picture from the quoted message's own attachments", () => {
    render(<QuotedLinkPreview media={media} messageId="m1" preview={preview} />);

    const [source, enabled] = mocks.useAttachmentBlobUrl.mock.calls[0];
    expect(source).toMatchObject({ cacheKey: "m1:link-preview:thumb", url: "https://cdn.example/thumb" });
    expect(enabled).toBe(true);
  });

  it.each([["loading"], ["error"], ["idle"]])("shows just the title while the picture is %s", (status) => {
    mocks.useAttachmentBlobUrl.mockReturnValue({ status });

    const { container } = render(<QuotedLinkPreview media={media} messageId="m1" preview={preview} />);

    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("A post")).toBeInTheDocument();
  });

  it("is not a link, since the quote itself jumps to the original", () => {
    render(<QuotedLinkPreview media={media} messageId="m1" preview={preview} />);

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("shows no title for a picture-only card", () => {
    mocks.useAttachmentBlobUrl.mockReturnValue({ status: "ready", url: "blob:decrypted" });

    const { container } = render(
      <QuotedLinkPreview media={media} messageId="m1" preview={{ url: preview.url, thumb: THUMB }} />,
    );

    expect(container.querySelector(".chat-reply-quote-preview-title")).toBeNull();
  });
});

describe("DraftLinkPreviewCard", () => {
  const preview = {
    url: "https://example.com/post",
    domain: "example.com",
    resolvedDomain: null,
    title: "A post",
    description: "About a thing",
    image: { mime: "image/png", data: "AAAA" },
  };

  it("shows the card as the server found it, with its picture", () => {
    const { container } = render(<DraftLinkPreviewCard preview={preview} />);

    expect(screen.getByText("A post")).toBeInTheDocument();
    expect(container.querySelector("img")).toHaveAttribute("src", "data:image/png;base64,AAAA");
  });

  it("is not a link in the composer, where a click should not leave the page", () => {
    render(<DraftLinkPreviewCard preview={preview} />);

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("is a link on a message that is still going out", () => {
    render(<DraftLinkPreviewCard linked preview={preview} />);

    expect(screen.getByRole("link")).toHaveAttribute("href", "https://example.com/post");
  });

  it("shows no picture when the page has none", () => {
    const { container } = render(<DraftLinkPreviewCard preview={{ ...preview, image: null }} />);

    expect(container.querySelector("img")).toBeNull();
  });

  it("shows where a short link leads and can be removed", () => {
    const onDismiss = vi.fn();
    render(<DraftLinkPreviewCard onDismiss={onDismiss} preview={{ ...preview, domain: "bit.ly", resolvedDomain: "example.com" }} />);

    expect(screen.getByText(/bit\.ly/)).toHaveTextContent("bit.ly → example.com");
    fireEvent.click(screen.getByRole("button", { name: "Remove link preview" }));
    expect(onDismiss).toHaveBeenCalled();
  });
});
