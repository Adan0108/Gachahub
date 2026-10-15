import { describe, expect, it } from "vitest";
import { EMOJI_IMAGE_BASE, emojiFileName, emojiImageUrl } from "./emojiImage";

const char = (...codePoints: number[]) => String.fromCodePoint(...codePoints);

describe("emojiFileName", () => {
  it.each([
    ["a simple emoji", "😀", "1f600"],
    ["a recent emoji", char(0x1fadb), "1fadb"],
    ["a heart with the emoji selector, which the pictures leave out", char(0x2764, 0xfe0f), "2764"],
    ["the same heart without it", char(0x2764), "2764"],
    ["a flag", char(0x1f1fb, 0x1f1f3), "1f1fb-1f1f3"],
    ["a skin tone", char(0x1f44d, 0x1f3fd), "1f44d-1f3fd"],
    ["a keycap, whose selector is dropped", char(0x31, 0xfe0f, 0x20e3), "31-20e3"],
    [
      "a family joined with joiners",
      char(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467, 0x200d, 0x1f466),
      "1f468-200d-1f469-200d-1f467-200d-1f466",
    ],
  ])("is right for %s", (_name, emoji, expected) => {
    expect(emojiFileName(emoji)).toBe(expected);
  });

  it("keeps the selector inside a joined sequence, where the pictures keep it", () => {
    const rainbowFlag = char(0x1f3f3, 0xfe0f, 0x200d, 0x1f308);

    expect(emojiFileName(rainbowFlag)).toBe("1f3f3-fe0f-200d-1f308");
  });

  it("writes the hex in lower case", () => {
    expect(emojiFileName(char(0x1f9d1))).toBe("1f9d1");
  });
});

describe("emojiImageUrl", () => {
  it("points at the pinned picture set", () => {
    expect(emojiImageUrl("😀")).toBe(`${EMOJI_IMAGE_BASE}/1f600.svg`);
  });

  it('is pinned to an exact version, never "latest"', () => {
    expect(EMOJI_IMAGE_BASE).toMatch(/@\d+\.\d+\.\d+\//);
    expect(EMOJI_IMAGE_BASE).not.toContain("latest");
  });

  it("only ever builds a plain https svg address", () => {
    const url = emojiImageUrl(char(0x1f1fb, 0x1f1f3));

    expect(url.startsWith("https://")).toBe(true);
    expect(url.endsWith(".svg")).toBe(true);
  });
});
