import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLinkPreviewDraft } from "../hooks/chat/useLinkPreviewDraft";

const mocks = vi.hoisted(() => ({ fetchLinkPreview: vi.fn() }));

vi.mock("../lib/api", () => ({
  api: { fetchLinkPreview: mocks.fetchLinkPreview },
  fallbackCategories: vi.fn(() => []),
  fallbackGame: vi.fn(),
  fallbackGames: vi.fn(() => ({ items: [] })),
  fallbackPosts: vi.fn(() => []),
}));

const PAUSE = 600;
const serverAnswer = (url, extra = {}) => ({
  url,
  domain: new URL(url).hostname,
  resolvedDomain: null,
  title: `Title of ${new URL(url).pathname}`,
  description: null,
  siteName: null,
  image: null,
  ...extra,
});

function setup(initial) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return renderHook((props) => useLinkPreviewDraft(props), { wrapper, initialProps: initial });
}

const pause = (ms = PAUSE) => act(() => vi.advanceTimersByTimeAsync(ms));

describe("useLinkPreviewDraft", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mocks.fetchLinkPreview.mockReset().mockImplementation(async (url) => serverAnswer(url));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does nothing for text with no link", async () => {
    const { result } = setup({ text: "just chatting", enabled: true });

    await pause();

    expect(mocks.fetchLinkPreview).not.toHaveBeenCalled();
    expect(result.current).toMatchObject({ preview: null, isLoading: false });
  });

  it("waits for typing to pause before asking about a link", async () => {
    const { result, rerender } = setup({ text: "", enabled: true });

    rerender({ text: "look https://example.com/a", enabled: true });
    await pause(PAUSE - 100);
    expect(mocks.fetchLinkPreview).not.toHaveBeenCalled();
    expect(result.current.isLoading).toBe(true);

    await pause(200);
    await waitFor(() => expect(result.current.preview).not.toBeNull());
    expect(mocks.fetchLinkPreview).toHaveBeenCalledWith("https://example.com/a");
  });

  it("gives the card, with the address as written in the message", async () => {
    const { result } = setup({ text: "look https://example.com/a#section", enabled: true });

    await pause();

    await waitFor(() => expect(result.current.preview).not.toBeNull());
    expect(result.current.preview).toMatchObject({ url: "https://example.com/a", title: "Title of /a" });
    expect(result.current.isLoading).toBe(false);
  });

  it("uses the browser's form of the address even when the server wrote it another way", async () => {
    mocks.fetchLinkPreview.mockResolvedValue(serverAnswer("https://example.com/a?x=1", { url: "https://example.com/a?x=1&" }));
    const { result } = setup({ text: "https://example.com/a?x=1", enabled: true });

    await pause();

    await waitFor(() => expect(result.current.preview).not.toBeNull());
    expect(result.current.preview.url).toBe("https://example.com/a?x=1");
  });

  it("asks only about the first link", async () => {
    setup({ text: "https://first.example/a and https://second.example/b", enabled: true });

    await pause();

    await waitFor(() => expect(mocks.fetchLinkPreview).toHaveBeenCalledTimes(1));
    expect(mocks.fetchLinkPreview).toHaveBeenCalledWith("https://first.example/a");
  });

  it("shows a placeholder while the server looks", async () => {
    mocks.fetchLinkPreview.mockReturnValue(new Promise(() => {}));
    const { result } = setup({ text: "https://example.com/a", enabled: true });

    await pause();

    expect(result.current).toMatchObject({ preview: null, isLoading: true });
  });

  it("shows no card, and no error, when the server has nothing for the link", async () => {
    mocks.fetchLinkPreview.mockRejectedValue(new Error("422"));
    const { result } = setup({ text: "https://example.com/a", enabled: true });

    await pause();

    await waitFor(() => expect(mocks.fetchLinkPreview).toHaveBeenCalled());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.preview).toBeNull();
  });

  it("does not ask again for a link it has just answered", async () => {
    const { result, rerender } = setup({ text: "https://example.com/a", enabled: true });
    await pause();
    await waitFor(() => expect(result.current.preview).not.toBeNull());

    rerender({ text: "https://example.com/a and some more words", enabled: true });
    await pause();

    expect(mocks.fetchLinkPreview).toHaveBeenCalledTimes(1);
    expect(result.current.preview).not.toBeNull();
  });

  describe("when the link changes", () => {
    it("drops the old card at once and asks about the new link after a pause", async () => {
      const { result, rerender } = setup({ text: "https://example.com/a", enabled: true });
      await pause();
      await waitFor(() => expect(result.current.preview).not.toBeNull());

      rerender({ text: "https://example.com/b", enabled: true });

      expect(result.current.preview).toBeNull();
      expect(result.current.isLoading).toBe(true);
      await pause();
      await waitFor(() => expect(result.current.preview).toMatchObject({ url: "https://example.com/b" }));
    });

    it("drops the card when the link is deleted from the message", async () => {
      const { result, rerender } = setup({ text: "https://example.com/a", enabled: true });
      await pause();
      await waitFor(() => expect(result.current.preview).not.toBeNull());

      rerender({ text: "no link now", enabled: true });

      expect(result.current).toMatchObject({ preview: null, isLoading: false });
    });

    it("does not ask about every half-typed address", async () => {
      const { rerender } = setup({ text: "https://exa", enabled: true });
      for (const text of ["https://exam", "https://example", "https://example.c", "https://example.com"]) {
        await pause(150);
        rerender({ text, enabled: true });
      }

      await pause();

      await waitFor(() => expect(mocks.fetchLinkPreview).toHaveBeenCalledTimes(1));
      expect(mocks.fetchLinkPreview).toHaveBeenCalledWith("https://example.com/");
    });
  });

  describe("removing the card", () => {
    it("hides it, and keeps it hidden while the same link is in the message", async () => {
      const { result, rerender } = setup({ text: "https://example.com/a", enabled: true });
      await pause();
      await waitFor(() => expect(result.current.preview).not.toBeNull());

      act(() => result.current.dismiss());
      expect(result.current.preview).toBeNull();

      rerender({ text: "https://example.com/a and more", enabled: true });
      await pause();
      expect(result.current.preview).toBeNull();
      expect(result.current.isLoading).toBe(false);
    });

    it("shows a different link's card again", async () => {
      const { result, rerender } = setup({ text: "https://example.com/a", enabled: true });
      await pause();
      await waitFor(() => expect(result.current.preview).not.toBeNull());
      act(() => result.current.dismiss());

      rerender({ text: "https://example.com/b", enabled: true });
      await pause();

      await waitFor(() => expect(result.current.preview).toMatchObject({ url: "https://example.com/b" }));
    });

    it("forgets it once the message is cleared, such as after sending", async () => {
      const { result, rerender } = setup({ text: "https://example.com/a", enabled: true });
      await pause();
      await waitFor(() => expect(result.current.preview).not.toBeNull());
      act(() => result.current.dismiss());

      rerender({ text: "", enabled: true });
      rerender({ text: "https://example.com/a", enabled: true });
      await pause();

      await waitFor(() => expect(result.current.preview).not.toBeNull());
    });
  });

  describe("when it is turned off", () => {
    it("never asks the server, and shows nothing", async () => {
      const { result } = setup({ text: "https://example.com/a", enabled: false });

      await pause(PAUSE * 2);

      expect(mocks.fetchLinkPreview).not.toHaveBeenCalled();
      expect(result.current).toMatchObject({ preview: null, isLoading: false });
    });

    it("drops the card when switched off mid-way, such as when a file is attached", async () => {
      const { result, rerender } = setup({ text: "https://example.com/a", enabled: true });
      await pause();
      await waitFor(() => expect(result.current.preview).not.toBeNull());

      rerender({ text: "https://example.com/a", enabled: false });

      expect(result.current.preview).toBeNull();
    });
  });
});
