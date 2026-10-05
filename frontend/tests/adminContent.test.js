import { beforeEach, describe, expect, it, vi } from "vitest";

describe("admin content API", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("lists flagged content and routes hide/restore by item type", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ items: [], meta: { page: 1, limit: 20, total: 0 } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: "post-1", status: "HIDDEN" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: "comment-1", status: "PUBLISHED" }),
      });
    vi.stubGlobal("fetch", fetchMock);
    const { api } = await import("../lib/api");

    await api.listAdminContent({ page: 1, limit: 20 });
    await api.hideContent({ type: "POST", id: "post-1", gameSlug: "wuthering-waves" });
    await api.restoreContent({ type: "COMMENT", id: "comment-1", gameSlug: "wuthering-waves" });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://localhost:3000/admin/content?page=1&limit=20",
      expect.objectContaining({ credentials: "include" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://localhost:3000/games/wuthering-waves/posts/post-1/hide",
      expect.objectContaining({ method: "PATCH" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "http://localhost:3000/games/wuthering-waves/comments/comment-1/restore",
      expect.objectContaining({ method: "PATCH" }),
    );
  });
});
