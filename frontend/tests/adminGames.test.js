import { beforeEach, describe, expect, it, vi } from "vitest";

describe("admin game API", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("uses the existing admin game endpoints and payloads", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ id: "game-1" }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: "game-1" }) });
    vi.stubGlobal("fetch", fetchMock);
    const { api } = await import("../lib/api");

    await api.createGame({ name: "Example Game", developer: "Studio" });
    await api.updateGame("game-1", { status: "HIDDEN" });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://localhost:3000/games",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({ name: "Example Game", developer: "Studio" }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://localhost:3000/games/game-1",
      expect.objectContaining({
        method: "PATCH",
        credentials: "include",
        body: JSON.stringify({ status: "HIDDEN" }),
      }),
    );
  });
});
