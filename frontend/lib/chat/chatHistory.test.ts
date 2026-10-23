import { describe, expect, it } from "vitest";
import { compareMessages, messagesFallenOutOfWindow } from "./chatHistory";

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

  // #101: live pushes grow the window past a page; the next poll brings it back to one page.
  it("keeps what a shrinking window dropped off its end", () => {
    expect(messagesFallenOutOfWindow(range(1, 60), range(11, 60)).map((m) => m.id)).toEqual(
      range(1, 10).map((m) => m.id),
    );
  });

  it("tells messages sent in the same millisecond apart by id", () => {
    const at = "2026-09-01T00:00:05.000Z";
    const a = { id: "a", createdAt: at };
    const b = { id: "b", createdAt: at };

    expect(messagesFallenOutOfWindow([a, b], [b])).toEqual([a]);
    expect(messagesFallenOutOfWindow([a, b], [a])).toEqual([]);
  });

  it("does not rescue anything when the window is empty", () => {
    expect(messagesFallenOutOfWindow(range(1, 3), [])).toEqual([]);
  });

  it("returns nothing when nothing changed", () => {
    expect(messagesFallenOutOfWindow(range(1, 5), range(1, 5))).toEqual([]);
  });
});

describe("compareMessages", () => {
  it("orders by time, then by id, the same however the messages arrived", () => {
    const at = "2026-09-01T00:00:05.000Z";
    const messages = [
      { id: "m9", createdAt: "2026-09-01T00:00:06.000Z" },
      { id: "b", createdAt: at },
      { id: "a", createdAt: at },
    ];

    expect([...messages].sort(compareMessages).map((m) => m.id)).toEqual(["a", "b", "m9"]);
    expect([...messages].reverse().sort(compareMessages).map((m) => m.id)).toEqual([
      "a",
      "b",
      "m9",
    ]);
  });

  it("finds a message equal to itself", () => {
    expect(compareMessages(message(1), message(1))).toBe(0);
  });
});
