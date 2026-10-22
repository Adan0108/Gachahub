import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logTiming, startTiming, timingEnabled } from "../lib/chat/chatTiming";

describe("chat timing", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(console, "debug").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("prints nothing unless it is switched on in this browser", () => {
    logTiming("push received", { messageId: "m1" });

    expect(timingEnabled()).toBe(false);
    expect(console.debug).not.toHaveBeenCalled();
  });

  it("prints the event and its details once switched on", () => {
    localStorage.setItem("gachahub:chat-timing", "1");

    logTiming("push received", { messageId: "m1" });

    expect(console.debug).toHaveBeenCalledWith("[chat timing] push received", { messageId: "m1" });
  });

  it("a stopwatch prints how long it ran, with what it was told", () => {
    localStorage.setItem("gachahub:chat-timing", "1");

    const stop = startTiming("upload", { files: 2 });
    stop({ bytes: 10 });

    expect(console.debug).toHaveBeenCalledWith(
      "[chat timing] upload",
      expect.objectContaining({ files: 2, bytes: 10, ms: expect.any(Number) }),
    );
  });

  it("a stopwatch costs nothing and prints nothing while it is off", () => {
    startTiming("upload")();

    expect(console.debug).not.toHaveBeenCalled();
  });
});
