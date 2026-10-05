import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MuteRow } from "../components/chat/MuteRow";

const mocks = vi.hoisted(() => ({ setChatNotificationLevel: vi.fn() }));

vi.mock("../hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ user: { id: "me" }, isAuthenticated: true }),
}));
vi.mock("../lib/api", () => ({
  api: { setChatNotificationLevel: mocks.setChatNotificationLevel },
  fallbackCategories: vi.fn(() => []),
  fallbackGame: vi.fn(),
  fallbackGames: vi.fn(() => ({ items: [] })),
  fallbackPosts: vi.fn(() => []),
}));

const conversation = (mine = {}) => ({
  id: "c1",
  participants: [
    { userId: "me", notificationLevel: "ALL", mutedUntil: null, isMuted: false, ...mine },
    { userId: "peer", notificationLevel: null, mutedUntil: null, isMuted: null },
  ],
});

function setup(mine) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MuteRow conversation={conversation(mine)} />
    </QueryClientProvider>,
  );
}

const openMenu = () => fireEvent.click(screen.getByRole("button", { name: /Mute notifications/ }));

describe("MuteRow", () => {
  beforeEach(() => {
    mocks.setChatNotificationLevel.mockReset().mockResolvedValue({});
  });

  it("opens the duration menu when you tap Mute", () => {
    setup();

    openMenu();

    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "15 minutes",
      "1 hour",
      "8 hours",
      "24 hours",
      "Until I turn it back on",
    ]);
  });

  it("mutes this conversation until the chosen time and closes the menu", async () => {
    setup();

    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "1 hour" }));

    await waitFor(() => expect(mocks.setChatNotificationLevel).toHaveBeenCalled());
    const [conversationId, change] = mocks.setChatNotificationLevel.mock.calls[0];
    expect(conversationId).toBe("c1");
    expect(change.notificationLevel).toBe("NOTHING");
    expect(Date.parse(change.mutedUntil) - Date.now()).toBeGreaterThan(59 * 60_000);
    expect(Date.parse(change.mutedUntil) - Date.now()).toBeLessThanOrEqual(60 * 60_000);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("mutes with no end time for the open-ended option", async () => {
    setup();

    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Until I turn it back on" }));

    await waitFor(() =>
      expect(mocks.setChatNotificationLevel).toHaveBeenCalledWith("c1", {
        notificationLevel: "NOTHING",
        mutedUntil: undefined,
      }),
    );
  });

  it("closes the menu on Escape without changing anything", () => {
    setup();

    openMenu();
    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(mocks.setChatNotificationLevel).not.toHaveBeenCalled();
  });

  it("shows Unmute with when it ends, and turns notifications straight back on", async () => {
    setup({ isMuted: true, mutedUntil: null });

    expect(screen.getByText("Muted until you turn it back on")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Unmute/ }));

    await waitFor(() =>
      expect(mocks.setChatNotificationLevel).toHaveBeenCalledWith("c1", { notificationLevel: "ALL" }),
    );
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("disables the control while a change is saving", async () => {
    mocks.setChatNotificationLevel.mockReturnValue(new Promise(() => {}));
    setup({ isMuted: true });

    fireEvent.click(screen.getByRole("button", { name: /Unmute/ }));

    await waitFor(() => expect(screen.getByRole("button", { name: /Unmute/ })).toBeDisabled());
  });

  it("tells you when the change did not save", async () => {
    mocks.setChatNotificationLevel.mockRejectedValue(new Error("nope"));
    setup({ isMuted: true });

    fireEvent.click(screen.getByRole("button", { name: /Unmute/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't update mute");
  });
});
