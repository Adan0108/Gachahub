import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppSocket } from "../hooks/useAppSocket";
import { useNotificationSocket } from "../hooks/useNotificationSocket";

const mocks = vi.hoisted(() => ({ handlers: {}, off: vi.fn(), disconnect: vi.fn(), authed: true }));

vi.mock("socket.io-client", () => ({
  io: () => ({
    on: (event, handler) => {
      mocks.handlers[event] = handler;
    },
    off: mocks.off,
    disconnect: mocks.disconnect,
    connect: () => {},
    emit: () => {},
  }),
}));
vi.mock("../hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ user: { id: "me" }, isAuthenticated: mocks.authed }),
}));
vi.mock("../lib/api", () => ({
  API_BASE_URL: "http://localhost:3000",
  api: {},
  fallbackCategories: vi.fn(() => []),
  fallbackGame: vi.fn(),
  fallbackGames: vi.fn(() => ({ items: [] })),
  fallbackPosts: vi.fn(() => []),
}));

function Probe() {
  useAppSocket();
  useNotificationSocket();
  return null;
}

function renderProbe() {
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const view = render(
    <QueryClientProvider client={client}>
      <Probe />
    </QueryClientProvider>,
  );
  return { invalidate, view };
}

describe("notification socket", () => {
  beforeEach(() => {
    mocks.handlers = {};
    mocks.off.mockReset();
    mocks.disconnect.mockReset();
    mocks.authed = true;
  });

  it("refreshes the bell when a notification arrives over the shared socket", () => {
    const { invalidate } = renderProbe();

    mocks.handlers["notification:new"]({ id: "n1" });

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["notifications"] });
  });

  it("removes only its own listener and closes the connection on unmount", () => {
    const { view } = renderProbe();

    view.unmount();

    expect(mocks.off).toHaveBeenCalledWith("notification:new", expect.any(Function));
    expect(mocks.disconnect).toHaveBeenCalledTimes(1);
  });

  it("opens no connection while signed out", () => {
    mocks.authed = false;
    renderProbe();

    expect(mocks.handlers["notification:new"]).toBeUndefined();
  });
});
