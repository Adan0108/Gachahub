import { beforeEach, describe, expect, it, vi } from "vitest";

describe("community chat API", () => {
  let fetchMock: any;
  let api: any;

  beforeEach(async () => {
    vi.resetModules();
    vi.unstubAllGlobals();
    fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    ({ api } = await import("../lib/api"));
  });

  const lastCall = () => fetchMock.mock.calls.at(-1);
  const body = () => JSON.parse(lastCall()[1].body);
  const BASE = "http://localhost:3000/games/wuwa/chat";

  it("lists the community's rooms", async () => {
    await api.getCommunityChannels("wuwa");

    expect(lastCall()[0]).toBe(BASE);
  });

  it("reads a room's newest page, or the page before a message", async () => {
    await api.getCommunityMessages("wuwa", "c1", { limit: 50 });
    expect(lastCall()[0]).toBe(`${BASE}/channels/c1/messages?limit=50`);

    await api.getCommunityMessages("wuwa", "c1", { before: "m9", limit: 50 });
    expect(lastCall()[0]).toBe(`${BASE}/channels/c1/messages?before=m9&limit=50`);
  });

  it("sends a message with its reply target and client id", async () => {
    await api.sendCommunityMessage("wuwa", "c1", {
      content: "hi",
      replyToId: "m1",
      clientMessageId: "x",
    });

    expect(lastCall()[0]).toBe(`${BASE}/channels/c1/messages`);
    expect(lastCall()[1]).toMatchObject({ method: "POST", credentials: "include" });
    expect(body()).toEqual({ content: "hi", replyToId: "m1", clientMessageId: "x" });
  });

  it("edits with a PATCH to the message", async () => {
    await api.editCommunityMessage("wuwa", "m1", "fixed");

    expect(lastCall()[0]).toBe(`${BASE}/messages/m1`);
    expect(lastCall()[1]).toMatchObject({ method: "PATCH" });
    expect(body()).toEqual({ content: "fixed" });
  });

  it("removes with a DELETE, carrying a moderator's reason when there is one", async () => {
    await api.removeCommunityMessage("wuwa", "m1", "spam");
    expect(lastCall()[1]).toMatchObject({ method: "DELETE" });
    expect(body()).toEqual({ reason: "spam" });

    await api.removeCommunityMessage("wuwa", "m1");
    expect(body()).toEqual({});
  });

  it("reacts with an emoji or with just the id of an emote", async () => {
    await api.reactToCommunityMessage("wuwa", "m1", { kind: "emoji", emoji: "👍" });
    expect(lastCall()[0]).toBe(`${BASE}/messages/m1/reactions`);
    expect(body()).toEqual({ emoji: "👍" });

    await api.reactToCommunityMessage("wuwa", "m1", {
      kind: "emote",
      emote: { id: "e1", shortcode: "pity" },
    });
    expect(body()).toEqual({ emoteId: "e1" });
  });

  it("takes a reaction back with a DELETE and no body", async () => {
    await api.unreactToCommunityMessage("wuwa", "m1");

    expect(lastCall()[0]).toBe(`${BASE}/messages/m1/reactions`);
    expect(lastCall()[1]).toMatchObject({ method: "DELETE" });
    expect(lastCall()[1].body).toBeUndefined();
  });

  it("marks a room read up to a message, or all of it", async () => {
    await api.markCommunityRead("wuwa", "c1", "m5");
    expect(lastCall()[0]).toBe(`${BASE}/channels/c1/read`);
    expect(body()).toEqual({ messageId: "m5" });

    await api.markCommunityRead("wuwa", "c1");
    expect(body()).toEqual({});
  });

  it("escapes a slug that is not plain", async () => {
    await api.getCommunityChannels("a/b");

    expect(lastCall()[0]).toBe("http://localhost:3000/games/a%2Fb/chat");
  });
});
