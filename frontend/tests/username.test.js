import { describe, expect, it } from "vitest";
import { USERNAME_PATTERN, canClaimHandle, mustOnboard } from "../lib/username";

describe("username helpers", () => {
  it.each(["bob", "Bob-12345", "a_b", "123"])("accepts %s", (handle) => {
    expect(USERNAME_PATTERN.test(handle)).toBe(true);
  });

  it.each(["ab", "-bob", "bob_", "a--b", "my_-name", "a-_b", "has space"])("rejects %s", (handle) => {
    expect(USERNAME_PATTERN.test(handle)).toBe(false);
  });

  it("only forces onboarding when onboarded is explicitly false", () => {
    expect(mustOnboard({ onboarded: false })).toBe(true);
    expect(mustOnboard({ onboarded: true })).toBe(false);
    expect(mustOnboard({})).toBe(false);
    expect(mustOnboard(null)).toBe(false);
  });

  it("lets any signed-in account without a handle claim one, even if backfilled", () => {
    expect(canClaimHandle({ onboarded: true, username: null })).toBe(true);
    expect(canClaimHandle({ onboarded: false, username: null })).toBe(true);
    expect(canClaimHandle({ username: "bob" })).toBe(false);
    expect(canClaimHandle(null)).toBe(false);
  });
});
