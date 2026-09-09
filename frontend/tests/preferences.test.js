import { describe, expect, it, vi } from "vitest";
import { readStoredJson } from "../lib/preferences";

describe("readStoredJson", () => {
  it("returns its fallback when browser storage is blocked", () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new Error("blocked");
      },
    });

    expect(readStoredJson("preferences", { games: [] })).toEqual({ games: [] });

    Object.defineProperty(window, "localStorage", descriptor);
  });

  it("returns valid stored JSON", () => {
    vi.spyOn(Storage.prototype, "getItem").mockReturnValue('{"games":["wuwa"]}');
    expect(readStoredJson("preferences", {})).toEqual({ games: ["wuwa"] });
  });
});
