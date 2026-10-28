import { beforeEach, describe, expect, it, vi } from "vitest";

describe("admin users API", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("lists users with filters and changes a user's status", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ items: [], meta: { page: 1, limit: 100, total: 0 } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: "user-1", status: "BANNED" }),
      });
    vi.stubGlobal("fetch", fetchMock);
    const { api } = await import("../lib/api");

    await api.listAdminUsers({ status: "ACTIVE", search: "rover" });
    await api.setUserStatus("user-1", { status: "BANNED", reason: "Repeated abuse" });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://localhost:3000/admin/users?status=ACTIVE&search=rover",
      expect.objectContaining({ credentials: "include" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://localhost:3000/admin/users/user-1/status",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ status: "BANNED", reason: "Repeated abuse" }),
      }),
    );
  });
});
