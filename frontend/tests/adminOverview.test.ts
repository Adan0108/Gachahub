import { beforeEach, describe, expect, it, vi } from "vitest";

describe("admin overview API", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("fetches the platform overview from the real backend", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ metrics: [], communities: [], activity: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const { api } = await import("../lib/api");

    await api.getAdminOverview();

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3000/admin/overview",
      expect.objectContaining({ credentials: "include" }),
    );
  });
});
