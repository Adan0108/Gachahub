import { beforeEach, describe, expect, it, vi } from "vitest";

describe("admin category API", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("uses the existing category endpoints and typed payloads", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ id: "category-1" }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: "category-1" }) });
    vi.stubGlobal("fetch", fetchMock);
    const { api } = await import("../lib/api");

    await api.createCategory("wuthering-waves", {
      name: "Guides",
      sortOrder: 2,
      isActive: true,
    });
    await api.updateCategory("category-1", { isActive: false, sortOrder: 3 });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://localhost:3000/games/wuthering-waves/categories",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({ name: "Guides", sortOrder: 2, isActive: true }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://localhost:3000/game-categories/category-1",
      expect.objectContaining({
        method: "PATCH",
        credentials: "include",
        body: JSON.stringify({ isActive: false, sortOrder: 3 }),
      }),
    );
  });
});
