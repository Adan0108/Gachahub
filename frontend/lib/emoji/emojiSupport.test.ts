import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmojiSupportCheck, type Measure } from "./emojiSupport";

const ONE_EMOJI_WIDTH = 40;

/** A device where the listed emoji are missing: they draw as a grey box (not coloured), or as several glyphs (too wide). */
function deviceMissing(missing: Record<string, "box" | "parts">): Measure {
  return (text) => {
    if (missing[text] === "box") return { width: ONE_EMOJI_WIDTH, colored: false };
    if (missing[text] === "parts") return { width: ONE_EMOJI_WIDTH * 3, colored: true };
    return { width: ONE_EMOJI_WIDTH, colored: true };
  };
}

describe("createEmojiSupportCheck", () => {
  it("says an emoji the device draws in colour, one emoji wide, is supported", () => {
    const check = createEmojiSupportCheck(deviceMissing({}));

    expect(check("😀")).toBe(true);
  });

  it("says an emoji that draws as a grey box is not", () => {
    const check = createEmojiSupportCheck(deviceMissing({ "\u{1FADB}": "box" }));

    expect(check("\u{1FADB}")).toBe(false);
  });

  it("says a joined sequence that falls apart into several glyphs is not", () => {
    const family = "👨‍👩‍👧";
    const check = createEmojiSupportCheck(deviceMissing({ [family]: "parts" }));

    expect(check(family)).toBe(false);
  });

  it("says a flag drawn as two letters, which is wider and plain, is not supported", () => {
    const flag = "🇻🇳";
    const measure: Measure = (text) =>
      text === flag
        ? { width: ONE_EMOJI_WIDTH * 1.9, colored: false }
        : { width: ONE_EMOJI_WIDTH, colored: true };

    expect(createEmojiSupportCheck(measure)(flag)).toBe(false);
  });

  it("tolerates a sequence that is a little wider than one emoji", () => {
    const measure: Measure = (text) =>
      text === "👍🏽"
        ? { width: ONE_EMOJI_WIDTH * 1.1, colored: true }
        : { width: ONE_EMOJI_WIDTH, colored: true };

    expect(createEmojiSupportCheck(measure)("👍🏽")).toBe(true);
  });

  it("answers each emoji separately", () => {
    const check = createEmojiSupportCheck(deviceMissing({ "\u{1FADB}": "box" }));

    expect(check("😀")).toBe(true);
    expect(check("\u{1FADB}")).toBe(false);
    expect(check("❤️")).toBe(true);
  });

  it("only asks the device once per emoji", () => {
    const measure = vi.fn<Measure>(() => ({ width: ONE_EMOJI_WIDTH, colored: true }));
    const check = createEmojiSupportCheck(measure);

    check("😀");
    check("😀");
    check("😀");

    expect(measure.mock.calls.filter(([text]) => text === "😀").length).toBe(2);
  });

  it("measures one ordinary emoji once, however many are checked, to know how wide one should be", () => {
    const measure = vi.fn<Measure>(() => ({ width: ONE_EMOJI_WIDTH, colored: true }));
    const check = createEmojiSupportCheck(measure);

    check("🙂");
    check("🙃");
    check("🙄");

    expect(measure.mock.calls.filter(([text]) => text === "😀")).toHaveLength(1);
  });

  describe("when the device cannot be asked", () => {
    it("assumes the emoji is fine rather than hiding it", () => {
      const check = createEmojiSupportCheck(() => null);

      expect(check("😀")).toBe(true);
      expect(check("\u{1FADB}")).toBe(true);
    });

    it("assumes it is fine when only the reference cannot be measured", () => {
      const measure: Measure = (text) => (text === "😀" ? null : { width: 400, colored: false });

      expect(createEmojiSupportCheck(measure)("\u{1FADB}")).toBe(true);
    });
  });
});

describe("measureOnCanvas", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  const stubCanvas = (pixels: number[], width = 36) => {
    const context = {
      clearRect: vi.fn(),
      fillText: vi.fn(),
      measureText: vi.fn(() => ({ width })),
      getImageData: vi.fn(() => ({ data: Uint8ClampedArray.from(pixels) })),
      font: "",
      textBaseline: "",
      fillStyle: "",
    };
    vi.stubGlobal("document", { createElement: () => ({ getContext: () => context }) });
    return context;
  };

  it("has no answer outside a browser", async () => {
    const { measureOnCanvas } = await import("./emojiSupport");

    expect(measureOnCanvas("😀")).toBeNull();
  });

  it("reports colour when any drawn pixel is not grey", async () => {
    stubCanvas([0, 0, 0, 0, 255, 120, 30, 255]);
    const { measureOnCanvas } = await import("./emojiSupport");

    expect(measureOnCanvas("😀")).toEqual({ width: 36, colored: true });
  });

  it("reports no colour for a grey or black box", async () => {
    stubCanvas([0, 0, 0, 255, 90, 90, 90, 255]);
    const { measureOnCanvas } = await import("./emojiSupport");

    expect(measureOnCanvas("□")).toEqual({ width: 36, colored: false });
  });

  it("ignores transparent pixels, which have no colour of their own", async () => {
    stubCanvas([255, 0, 0, 0]);
    const { measureOnCanvas } = await import("./emojiSupport");

    expect(measureOnCanvas("x")?.colored).toBe(false);
  });

  it("has no answer when the browser refuses to read pixels", async () => {
    const context = stubCanvas([0, 0, 0, 255]);
    context.getImageData.mockImplementation(() => {
      throw new Error("blocked");
    });
    const { measureOnCanvas } = await import("./emojiSupport");

    expect(measureOnCanvas("😀")).toBeNull();
  });

  it("has no answer when there is no drawing context", async () => {
    vi.stubGlobal("document", { createElement: () => ({ getContext: () => null }) });
    const { measureOnCanvas } = await import("./emojiSupport");

    expect(measureOnCanvas("😀")).toBeNull();
  });
});
