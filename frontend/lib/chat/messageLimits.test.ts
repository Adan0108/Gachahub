import { describe, expect, it } from "vitest";
import { assertMessageSize, MAX_MESSAGE_BYTES, textMessageBytes } from "./messageLimits";

describe("message size limits", () => {
  it("accounts for UTF-8 and JSON envelope overhead", () => {
    expect(textMessageBytes("é") - textMessageBytes("")).toBe(2);
    expect(textMessageBytes("😀") - textMessageBytes("")).toBe(4);
    expect(textMessageBytes('"') - textMessageBytes("")).toBe(2);
  });

  it("accepts the boundary and rejects oversized text without truncating it", () => {
    const text = "x".repeat(MAX_MESSAGE_BYTES - textMessageBytes(""));
    expect(() => assertMessageSize({ v: 1, type: "text", body: text })).not.toThrow();
    expect(() => assertMessageSize({ v: 1, type: "text", body: text + "x" })).toThrow(/too long/);
    expect(() => assertMessageSize({ v: 1, type: "text", body: "😀".repeat(4000) })).toThrow(
      /too long/,
    );
  });
});
