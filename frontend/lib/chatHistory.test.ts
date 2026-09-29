import { describe, expect, it } from "vitest";
import { messagesFallenOutOfWindow } from "./chatHistory";

const message = (n: number) => ({
  id: `m${n}`,
  createdAt: `2026-09-01T00:00:${String(n).padStart(2, "0")}.000Z`,
});
const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => message(from + i));

describe("messagesFallenOutOfWindow", () => {
  it("returns what scrolled off the end as new messages arrived", () => {
    expect(messagesFallenOutOfWindow(range(1, 30), range(3, 32)).map((m) => m.id)).toEqual([
      "m1",
      "m2",
    ]);
  });

  it("does not rescue a deleted message from the middle of the window", () => {
    const latest = range(1, 30).filter((m) => m.id !== "m15");

    expect(messagesFallenOutOfWindow(range(1, 30), latest)).toEqual([]);
  });

  it("does not rescue the deleted oldest message of a conversation shorter than a full window", () => {
    const previous = range(1, 10);
    const latest = range(2, 10);

    expect(messagesFallenOutOfWindow(previous, latest)).toEqual([]);
  });

  it("does not rescue anything when the window is empty", () => {
    expect(messagesFallenOutOfWindow(range(1, 3), [])).toEqual([]);
  });

  it("returns nothing when nothing changed", () => {
    expect(messagesFallenOutOfWindow(range(1, 5), range(1, 5))).toEqual([]);
  });
});
