import { afterEach, describe, expect, it, vi } from "vitest";
import { api, normalizePost } from "../lib/api";

describe("personal content display and admin routing", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses content as display title and preserves null classification", () => {
    expect(
      normalizePost({ id: "p", title: "", content: "My story", game: null, type: null }),
    ).toMatchObject({ title: "My story", type: null, gameName: undefined });
  });

  it.each(["POST", "COMMENT"])("uses admin routes only for personal %s content", async (type) => {
    const fetch = vi.fn(
      async () =>
        new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetch);
    const kind = type === "POST" ? "posts" : "comments";
    await api.hideContent({ id: "item", type, gameSlug: null });
    expect(String(fetch.mock.calls[0][0])).toContain(`/admin/${kind}/item/hide`);
    await api.restoreContent({ id: "item", type, gameSlug: "community" });
    expect(String(fetch.mock.calls[1][0])).toContain(`/games/community/${kind}/item/restore`);
  });
});
