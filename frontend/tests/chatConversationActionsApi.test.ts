import { beforeEach, describe, expect, it, vi } from "vitest";

describe("chat conversation action API", () => {
  let fetchMock: ReturnType<typeof vi.fn<(input: unknown, init?: RequestInit) => Promise<unknown>>>;
  let api: typeof import("../lib/api").api;

  beforeEach(async () => {
    vi.resetModules();
    vi.unstubAllGlobals();
    fetchMock = vi
      .fn<(input: unknown, init?: RequestInit) => Promise<unknown>>()
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    ({ api } = await import("../lib/api"));
  });

  const lastCall = () => {
    const call = fetchMock.mock.calls.at(-1)!;
    return [call[0], call[1]!] as const;
  };

  it("archives a chat with a POST to its archive address", async () => {
    await api.archiveChatConversation("c1");

    expect(lastCall()[0]).toBe("http://localhost:3000/chat/conversations/c1/archive");
    expect(lastCall()[1]).toMatchObject({ method: "POST", credentials: "include" });
  });

  it("unarchives it with a DELETE to the same address", async () => {
    await api.unarchiveChatConversation("c1");

    expect(lastCall()[0]).toBe("http://localhost:3000/chat/conversations/c1/archive");
    expect(lastCall()[1]).toMatchObject({ method: "DELETE", credentials: "include" });
  });

  it("deletes a chat with a DELETE to the chat itself, not its archive", async () => {
    await api.deleteChatConversation("c1");

    expect(lastCall()[0]).toBe("http://localhost:3000/chat/conversations/c1");
    expect(lastCall()[1]).toMatchObject({ method: "DELETE", credentials: "include" });
  });

  it("blocks a chat with a POST to its block address", async () => {
    await api.blockChatConversation("c1");

    expect(lastCall()[0]).toBe("http://localhost:3000/chat/conversations/c1/block");
    expect(lastCall()[1]).toMatchObject({ method: "POST" });
  });

  it("sends no body for any of them", async () => {
    for (const call of [
      () => api.archiveChatConversation("c1"),
      () => api.unarchiveChatConversation("c1"),
      () => api.deleteChatConversation("c1"),
    ]) {
      await call();
      expect(lastCall()[1].body).toBeUndefined();
    }
  });

  it.each([
    ["archiveChatConversation", "/archive"],
    ["unarchiveChatConversation", "/archive"],
    ["deleteChatConversation", ""],
  ] as const)("escapes an id with odd characters in %s", async (name, suffix) => {
    await api[name]("a/b c");

    expect(lastCall()[0]).toBe(`http://localhost:3000/chat/conversations/a%2Fb%20c${suffix}`);
  });

  it("fails when the server refuses", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ message: "Only active conversations can be archived" }),
    });

    await expect(api.archiveChatConversation("c1")).rejects.toThrow();
  });
});
