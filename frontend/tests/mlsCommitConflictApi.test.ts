import { beforeEach, describe, expect, it, vi } from "vitest";

// #97: the server's 409 for a lost commit race, exactly as HttpExceptionFilter now sends it
const conflictBody = {
  success: false,
  statusCode: 409,
  message: "Another commit already won this epoch",
  outcome: "conflict",
  handshake: { id: "h-7", epoch: 7, payload: "AAEC" },
  path: "/mls-handshakes/conversations/c1",
  timestamp: "2026-10-21T00:00:00.000Z",
};

describe("MLS commit submit API", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let api: typeof import("../lib/api").api;

  beforeEach(async () => {
    vi.resetModules();
    vi.unstubAllGlobals();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    ({ api } = await import("../lib/api"));
  });

  it("hands back the winning handshake of a lost race instead of throwing", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 409, json: async () => conflictBody });

    await expect(api.submitMlsHandshake("c1", {})).resolves.toMatchObject({
      outcome: "conflict",
      handshake: conflictBody.handshake,
    });
    await expect(api.submitMlsExternalJoin("c1", {})).resolves.toMatchObject({ outcome: "conflict" });
  });

  it("still throws an ordinary 409 that carries no winner", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ statusCode: 409, message: "The group moved on" }),
    });

    await expect(api.submitMlsHandshake("c1", {})).rejects.toMatchObject({ status: 409 });
  });
});
