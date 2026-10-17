import { beforeEach, describe, expect, it, vi } from "vitest";

describe("admin reports API", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("lists reports across every game and claims one in its own game scope", async () => {
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
        json: async () => ({ id: "report-1", status: "IN_REVIEW" }),
      });
    vi.stubGlobal("fetch", fetchMock);
    const { api } = await import("../lib/api");

    await api.listReports({ status: "PENDING" });
    await api.claimReport("genshin-impact", "report-1");

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://localhost:3000/admin/reports?status=PENDING",
      expect.objectContaining({ credentials: "include" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://localhost:3000/games/genshin-impact/reports/report-1/claim",
      expect.objectContaining({ method: "PATCH", credentials: "include" }),
    );
  });

  it("resolves and dismisses a report with just a resolution note, no resolution-type enum", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: "report-1", status: "RESOLVED" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: "report-2", status: "DISMISSED" }),
      });
    vi.stubGlobal("fetch", fetchMock);
    const { api } = await import("../lib/api");

    await api.resolveReport("genshin-impact", "report-1", { resolutionNote: "Handled" });
    await api.dismissReport("genshin-impact", "report-2", { resolutionNote: "No violation" });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://localhost:3000/games/genshin-impact/reports/report-1/resolve",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ resolutionNote: "Handled" }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://localhost:3000/games/genshin-impact/reports/report-2/dismiss",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ resolutionNote: "No violation" }),
      }),
    );
  });
});
