import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SEND_LIMIT, SEND_WINDOW_MS } from "../lib/chat/messageLimits";
import { COMMUNITY_SEND_LIMIT } from "../lib/community/communityChat";

/** The window and cap a backend rate limiter is configured with, read from its source. */
function backendLimiter(file: string) {
  // Tests run from frontend/, locally and in CI.
  const source = readFileSync(resolve(process.cwd(), "../backend/src", file), "utf8");
  const number = (name: string) => {
    const match = new RegExp(`${name}:\\s*([\\d_]+)`).exec(source);
    if (!match) throw new Error(`${name} not found in ${file}`);
    return Number(match[1]!.replace(/_/g, ""));
  };
  return { windowMs: number("windowMs"), maxPerWindow: number("maxPerWindow") };
}

// The composer stops sending before the server would refuse; if these drift, sends start failing.
describe("send limits match the server's", () => {
  it("in direct and group chats", () => {
    expect(backendLimiter("chat/chat-message-rate-limiter.service.ts")).toEqual({
      windowMs: SEND_WINDOW_MS,
      maxPerWindow: SEND_LIMIT,
    });
  });

  it("in community rooms", () => {
    expect(backendLimiter("community-chat/community-chat-rate-limiter.service.ts")).toEqual({
      windowMs: SEND_WINDOW_MS,
      maxPerWindow: COMMUNITY_SEND_LIMIT,
    });
  });
});
