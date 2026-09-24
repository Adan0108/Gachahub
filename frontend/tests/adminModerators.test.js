import { beforeEach, describe, expect, it, vi } from "vitest";

describe("admin moderator API", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("uses game-scoped list, assignment, and removal endpoints", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ id: "assignment-1" }) })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ message: "Moderator removed successfully" }),
      });
    vi.stubGlobal("fetch", fetchMock);
    const { api } = await import("../lib/api");

    await api.getGameModerators("genshin-impact");
    await api.assignGameModerator("genshin-impact", { email: "mod@example.com" });
    await api.removeGameModerator("genshin-impact", "user-1");

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://localhost:3000/games/genshin-impact/moderators",
      expect.objectContaining({ credentials: "include" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://localhost:3000/games/genshin-impact/moderators",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ email: "mod@example.com" }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "http://localhost:3000/games/genshin-impact/moderators/user-1",
      expect.objectContaining({ method: "DELETE", credentials: "include" }),
    );
  });
});
