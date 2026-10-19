import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChatVideoPlayer } from "../components/chat/ChatVideoPlayer";
import { clampTime, formatClock } from "../lib/chat/videoTime";

describe("video time helpers", () => {
  it("writes seconds as a clock", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(75)).toBe("1:15");
    expect(formatClock(3725)).toBe("1:02:05");
    expect(formatClock(9.9)).toBe("0:09");
  });

  it("treats anything that is not a usable time as the start", () => {
    expect(formatClock(NaN)).toBe("0:00");
    expect(formatClock(Infinity)).toBe("0:00");
    expect(formatClock(-5)).toBe("0:00");
  });

  it("keeps a position between the start and the end", () => {
    expect(clampTime(-3, 10)).toBe(0);
    expect(clampTime(4, 10)).toBe(4);
    expect(clampTime(40, 10)).toBe(10);
    expect(clampTime(5, NaN)).toBe(0);
  });
});

describe("ChatVideoPlayer", () => {
  let paused;
  beforeEach(() => {
    paused = true;
    HTMLMediaElement.prototype.play = vi.fn(function play() {
      paused = false;
      this.dispatchEvent(new Event("play"));
      return Promise.resolve();
    });
    HTMLMediaElement.prototype.pause = vi.fn(function pause() {
      paused = true;
      this.dispatchEvent(new Event("pause"));
    });
    Object.defineProperty(HTMLMediaElement.prototype, "paused", { configurable: true, get: () => paused });
    HTMLElement.prototype.requestFullscreen = vi.fn();
  });

  const setup = (props = {}) => {
    const view = render(<ChatVideoPlayer label="clip.mp4" poster="blob:poster" src="blob:video" {...props} />);
    const video = view.container.querySelector("video");
    Object.defineProperty(video, "duration", { configurable: true, value: 90 });
    fireEvent(video, new Event("loadedmetadata"));
    return { video, ...view };
  };

  it("starts as a poster with a big play button, and no native controls", () => {
    const { video } = setup();

    expect(screen.getByRole("button", { name: "Play clip.mp4" })).toBeInTheDocument();
    expect(video).not.toHaveAttribute("controls");
    expect(video).toHaveAttribute("poster", "blob:poster");
  });

  it("plays from the big button, then pauses and plays from the bar", () => {
    setup();

    fireEvent.click(screen.getByRole("button", { name: "Play clip.mp4" }));
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Play clip.mp4" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
  });

  it("shows the time and the length", () => {
    const { video } = setup();
    video.currentTime = 12;

    fireEvent(video, new Event("timeupdate"));

    expect(screen.getByText("0:12 / 1:30")).toBeInTheDocument();
  });

  it("seeks from the bar", () => {
    const { video } = setup();

    fireEvent.change(screen.getByRole("slider", { name: "Seek" }), { target: { value: "45" } });

    expect(video.currentTime).toBe(45);
    expect(screen.getByText("0:45 / 1:30")).toBeInTheDocument();
  });

  it("mutes and unmutes, and a volume of zero counts as muted", () => {
    setup();

    fireEvent.click(screen.getByRole("button", { name: "Mute" }));
    expect(screen.getByRole("button", { name: "Unmute" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Unmute" }));
    fireEvent.change(screen.getByRole("slider", { name: "Volume" }), { target: { value: "0" } });

    expect(screen.getByRole("button", { name: "Unmute" })).toBeInTheDocument();
  });

  it("goes fullscreen from the bar", () => {
    setup();

    fireEvent.click(screen.getByRole("button", { name: "Fullscreen" }));

    expect(HTMLElement.prototype.requestFullscreen).toHaveBeenCalled();
  });

  it("can be driven from the keyboard", () => {
    const { video } = setup();
    const player = screen.getByRole("group", { name: "clip.mp4" });
    video.currentTime = 20;

    fireEvent.keyDown(player, { key: " " });
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(player, { key: "k" });
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(player, { key: "ArrowRight" });
    expect(video.currentTime).toBe(25);
    fireEvent.keyDown(player, { key: "ArrowLeft" });
    expect(video.currentTime).toBe(20);
    fireEvent.keyDown(player, { key: "m" });
    expect(screen.getByRole("button", { name: "Unmute" })).toBeInTheDocument();
    fireEvent.keyDown(player, { key: "f" });
    expect(HTMLElement.prototype.requestFullscreen).toHaveBeenCalled();
  });

  it("does not take the arrow keys away from the sliders", () => {
    const { video } = setup();
    video.currentTime = 20;

    fireEvent.keyDown(screen.getByRole("slider", { name: "Seek" }), { key: "ArrowRight" });

    expect(video.currentTime).toBe(20);
  });

  it("shows play again once it has ended", () => {
    const { video } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Play clip.mp4" }));

    act(() => {
      fireEvent(video, new Event("ended"));
    });

    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
  });
});
