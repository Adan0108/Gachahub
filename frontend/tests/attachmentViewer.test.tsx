import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AttachmentLightbox } from "../components/chat/AttachmentLightbox";
import { VideoTile } from "../components/chat/AttachmentTiles";
import { AttachmentLightboxContext } from "../lib/mls/media/attachmentLightboxContext";

vi.mock("../hooks/chat/useAttachmentBlobUrl", () => ({
  useAttachmentBlobUrl: (source: any, enabled: any) =>
    source && enabled
      ? { status: "ready", url: `blob:${source.cacheKey}` }
      : { status: "idle", url: null },
}));
vi.mock("../lib/mls/media/saveAttachment", () => ({ saveAttachment: vi.fn() }));

const item = (name: any, mime: any, extra: any = {}): any => ({
  cacheKey: `k-${name}`,
  messageId: "m1",
  file: { name, mime, size: 10 },
  source: { cacheKey: `k-${name}`, url: `https://cdn/${name}` },
  thumbSource: null,
  ...extra,
});

const MEDIA = [
  item("a.png", "image/png"),
  item("clip.mp4", "video/mp4", { thumbSource: { cacheKey: "t-clip", url: "https://cdn/t" } }),
  item("c.png", "image/png"),
];

describe("AttachmentLightbox", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  const open = (index: any, items = MEDIA, onNavigate = vi.fn()) => {
    render(<AttachmentLightbox index={index} items={items} onClose={vi.fn()} onNavigate={onNavigate} />);
    return onNavigate;
  };

  it("lists every picture and video of the thread under the open one, and marks it", () => {
    open(0);

    const strip = screen.getByRole("list", { name: "Media in this chat" });
    expect(within(strip).getAllByRole("button")).toHaveLength(3);
    expect(screen.getByRole("button", { name: "Show a.png" })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("button", { name: "Show c.png" })).not.toHaveAttribute("aria-current");
  });

  it("jumps to the one that is clicked, as a step from where it is", () => {
    const onNavigate = open(0);

    fireEvent.click(screen.getByRole("button", { name: "Show c.png" }));

    expect(onNavigate).toHaveBeenCalledWith(2);
  });

  it("goes back from the last one the same way", () => {
    const onNavigate = open(2);

    fireEvent.click(screen.getByRole("button", { name: "Show a.png" }));

    expect(onNavigate).toHaveBeenCalledWith(-2);
  });

  it("shows no strip for a single picture", () => {
    open(0, [MEDIA[0]]);

    expect(screen.queryByRole("list", { name: "Media in this chat" })).not.toBeInTheDocument();
  });

  it("plays a video in the viewer, without a way to expand it again", () => {
    const { container } = render(
      <AttachmentLightbox index={1} items={MEDIA} onClose={vi.fn()} onNavigate={vi.fn()} />,
    );

    expect(container.querySelector("video")).toHaveAttribute("src", "blob:k-clip.mp4");
    expect(container.querySelector("video")).toHaveAttribute("poster", "blob:t-clip");
    expect(screen.queryByRole("button", { name: /Fullscreen|Open larger/ })).not.toBeInTheDocument();
  });

  it("shows a picture as a picture", () => {
    const { container } = render(
      <AttachmentLightbox index={0} items={MEDIA} onClose={vi.fn()} onNavigate={vi.fn()} />,
    );

    expect(container.querySelector(".attachment-lightbox-body img")).toHaveAttribute("src", "blob:k-a.png");
    expect(container.querySelector("video")).toBeNull();
  });
});

describe("a video in the thread", () => {
  beforeEach(() => {
    HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve());
    HTMLMediaElement.prototype.pause = vi.fn();
  });

  it("has no download button, and its expand button opens the viewer on it", () => {
    const openAttachment = vi.fn();
    const clip = MEDIA[1];
    render(
      <AttachmentLightboxContext.Provider value={openAttachment}>
        <VideoTile file={clip.file} source={clip.source} thumbSource={clip.thumbSource} />
      </AttachmentLightboxContext.Provider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Play clip.mp4" }));

    expect(screen.queryByRole("button", { name: /Download/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open larger" }));

    expect(openAttachment).toHaveBeenCalledWith("k-clip.mp4");
  });
});
