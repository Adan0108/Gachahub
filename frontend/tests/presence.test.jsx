import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PresenceDot } from "../components/PresenceDot";
import { StatusMenu } from "../components/StatusMenu";
import { useOfflineExpiryNotice } from "../hooks/presence/useMyPresence";
import {
  PRESENCE_PING_MS,
  PRESENCE_REFRESH_MS,
  usePresenceSocket,
} from "../hooks/presence/usePresenceSocket";
import { describeUntil, OFFLINE_DURATIONS } from "../lib/presence/offlineDurations";
import { createPresenceStore, presenceStore } from "../lib/presence/presenceStore";
import { queryKeys } from "../lib/queries";

const socketMock = vi.hoisted(() => ({ current: null }));
vi.mock("../lib/socket/sharedSocket", () => ({ useSharedSocket: () => socketMock.current }));

function fakeSocket() {
  const handlers = new Map();
  return {
    connected: true,
    emit: vi.fn(),
    on: vi.fn((event, handler) => handlers.set(event, handler)),
    off: vi.fn((event) => handlers.delete(event)),
    fire: (event, payload) => handlers.get(event)?.(payload),
    handlers,
  };
}

describe("createPresenceStore", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("reads as unknown until someone is asked about and answered", async () => {
    const fetchPresence = vi.fn().mockResolvedValue({ a: "ONLINE" });
    const store = createPresenceStore({ fetchPresence });

    expect(store.get("a")).toBeUndefined();
    store.request("a");
    await vi.advanceTimersByTimeAsync(60);

    expect(store.get("a")).toBe("ONLINE");
  });

  it("asks once for everyone requested in the same moment, and once per person", async () => {
    const fetchPresence = vi.fn().mockResolvedValue({});
    const store = createPresenceStore({ fetchPresence });

    store.request("a");
    store.request("b");
    store.request("a");
    await vi.advanceTimersByTimeAsync(60);
    store.request("a");
    await vi.advanceTimersByTimeAsync(60);

    expect(fetchPresence).toHaveBeenCalledTimes(1);
    expect(fetchPresence).toHaveBeenCalledWith(["a", "b"]);
  });

  it("splits a big batch into requests of at most 100", async () => {
    const fetchPresence = vi.fn().mockResolvedValue({});
    const store = createPresenceStore({ fetchPresence });

    for (let index = 0; index < 150; index += 1) store.request(`u${index}`);
    await vi.advanceTimersByTimeAsync(60);

    expect(fetchPresence.mock.calls.map(([ids]) => ids.length)).toEqual([100, 50]);
  });

  it("tells listeners only when something changed, and lets a failed lookup be retried", async () => {
    const fetchPresence = vi
      .fn()
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValue({ a: "OFFLINE" });
    const store = createPresenceStore({ fetchPresence });
    const listener = vi.fn();
    store.subscribe(listener);

    store.set("a", "ONLINE");
    store.set("a", "ONLINE");
    expect(listener).toHaveBeenCalledTimes(1);

    store.request("b");
    await vi.advanceTimersByTimeAsync(60);
    store.request("b");
    await vi.advanceTimersByTimeAsync(60);
    expect(fetchPresence).toHaveBeenCalledTimes(2);
  });

  it("asks about everyone known again after a reconnect, and forgets all on clear", async () => {
    const fetchPresence = vi.fn().mockResolvedValue({});
    const store = createPresenceStore({ fetchPresence });
    store.setMany({ a: "ONLINE", b: "OFFLINE" });

    store.refreshAll();
    await vi.advanceTimersByTimeAsync(60);
    expect(fetchPresence).toHaveBeenCalledWith(["a", "b"]);

    store.clear();
    expect(store.get("a")).toBeUndefined();
  });
});

describe("usePresenceSocket", () => {
  const wrapper = (client) =>
    function Wrapper({ children }) {
      return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    };

  beforeEach(() => {
    vi.useFakeTimers();
    presenceStore.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
    socketMock.current = null;
  });

  it("pings now and every interval, and stops when it unmounts", () => {
    const socket = fakeSocket();
    socketMock.current = socket;
    const { unmount } = renderHook(() => usePresenceSocket(), {
      wrapper: wrapper(new QueryClient()),
    });

    expect(socket.emit).toHaveBeenCalledWith("presence:ping");
    act(() => vi.advanceTimersByTime(PRESENCE_PING_MS));
    expect(socket.emit).toHaveBeenCalledTimes(2);

    unmount();
    act(() => vi.advanceTimersByTime(PRESENCE_PING_MS * 2));
    expect(socket.emit).toHaveBeenCalledTimes(2);
    expect(socket.handlers.size).toBe(0);
  });

  it("applies other people's changes and mirrors your own choice", () => {
    const socket = fakeSocket();
    socketMock.current = socket;
    const client = new QueryClient();
    renderHook(() => usePresenceSocket(), { wrapper: wrapper(client) });

    act(() => socket.fire("presence:update", { userId: "bo", status: "ONLINE" }));
    act(() => socket.fire("presence:self", { status: "INVISIBLE", until: null }));

    expect(presenceStore.get("bo")).toBe("ONLINE");
    expect(client.getQueryData(queryKeys.myPresence)).toEqual({ status: "INVISIBLE", until: null });
  });

  it("asks about everyone shown again every so often, and when the tab comes back, but not while hidden", () => {
    const socket = fakeSocket();
    socketMock.current = socket;
    const refresh = vi.spyOn(presenceStore, "refreshAll");
    renderHook(() => usePresenceSocket(), { wrapper: wrapper(new QueryClient()) });

    act(() => vi.advanceTimersByTime(PRESENCE_REFRESH_MS));
    expect(refresh).toHaveBeenCalledTimes(1);

    document.dispatchEvent(new Event("visibilitychange"));
    expect(refresh).toHaveBeenCalledTimes(2);

    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    act(() => vi.advanceTimersByTime(PRESENCE_REFRESH_MS));
    document.dispatchEvent(new Event("visibilitychange"));
    expect(refresh).toHaveBeenCalledTimes(2);

    refresh.mockRestore();
    vi.restoreAllMocks();
  });

  it("forgets everyone when there is no connection any more", () => {
    presenceStore.set("bo", "ONLINE");
    socketMock.current = null;

    renderHook(() => usePresenceSocket(), { wrapper: wrapper(new QueryClient()) });

    expect(presenceStore.get("bo")).toBeUndefined();
  });
});

describe("useOfflineExpiryNotice", () => {
  const NOW = Date.parse("2026-10-17T12:00:00Z");
  beforeEach(() => vi.useFakeTimers().setSystemTime(NOW));
  afterEach(() => vi.useRealTimers());

  const run = (before, after) => {
    const notify = vi.fn();
    const { rerender } = renderHook(({ me }) => useOfflineExpiryNotice(me, notify), {
      initialProps: { me: before },
    });
    rerender({ me: after });
    return notify;
  };
  const offlineUntil = (offset) => ({
    status: "INVISIBLE",
    until: new Date(NOW + offset).toISOString(),
  });

  it("says so when a timed choice runs out", () => {
    expect(run(offlineUntil(-1000), { status: "ONLINE", until: null })).toHaveBeenCalledWith(
      "You're visible again",
    );
  });

  it("stays quiet when you go online by hand before the end, or from forever", () => {
    expect(run(offlineUntil(3_600_000), { status: "ONLINE", until: null })).not.toHaveBeenCalled();
    expect(
      run({ status: "INVISIBLE", until: null }, { status: "ONLINE", until: null }),
    ).not.toHaveBeenCalled();
  });

  it("stays quiet on first load", () => {
    expect(run(undefined, { status: "ONLINE", until: null })).not.toHaveBeenCalled();
  });
});

describe("describeUntil", () => {
  it("is empty with no end, and names the time or the day", () => {
    const now = new Date(2026, 9, 17, 12, 0).getTime();

    expect(describeUntil(null, now)).toBe("");
    expect(describeUntil(new Date(2026, 9, 17, 15, 40), now)).toMatch(/^until .*40/);
    expect(describeUntil(new Date(2026, 9, 20, 15, 40), now)).toMatch(/^until \w{3,} .*40/);
  });

  it("lists Discords six durations", () => {
    expect(OFFLINE_DURATIONS.map((item) => item.value)).toEqual([
      "15m",
      "1h",
      "8h",
      "24h",
      "3d",
      "forever",
    ]);
  });
});

describe("PresenceDot", () => {
  it("shows green for online, a ring for yourself while hidden, and nothing for offline or unknown", () => {
    const { rerender, container } = render(<PresenceDot status="ONLINE" />);
    expect(screen.getByLabelText("Online")).toBeInTheDocument();

    rerender(<PresenceDot own status="INVISIBLE" />);
    expect(screen.getByLabelText("Appearing offline")).toBeInTheDocument();

    rerender(<PresenceDot status="INVISIBLE" />);
    expect(container).toBeEmptyDOMElement();
    rerender(<PresenceDot status="OFFLINE" />);
    expect(container).toBeEmptyDOMElement();
    rerender(<PresenceDot status={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("StatusMenu", () => {
  const open = () => fireEvent.click(screen.getByRole("menuitem", { name: /online|offline/i }));

  it("shows who you are now, and goes online in one click", () => {
    const onChoose = vi.fn();
    render(<StatusMenu me={{ status: "INVISIBLE", until: null }} onChoose={onChoose} />);
    expect(screen.getByText("until you change it")).toBeInTheDocument();

    open();
    fireEvent.click(screen.getByRole("menuitemradio", { name: /online/i }));

    expect(onChoose).toHaveBeenCalledWith({ status: "ONLINE" });
  });

  it("offers every duration for appearing offline and sends the one picked", () => {
    const onChoose = vi.fn();
    render(<StatusMenu me={{ status: "ONLINE", until: null }} onChoose={onChoose} />);

    open();
    fireEvent.click(screen.getByRole("menuitem", { name: /offline/i }));
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual(
      expect.arrayContaining(OFFLINE_DURATIONS.map((item) => item.label)),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "For 8 Hours" }));

    expect(onChoose).toHaveBeenCalledWith({ status: "INVISIBLE", duration: "8h" });
  });

  it("closes after a choice", () => {
    render(<StatusMenu me={{ status: "ONLINE", until: null }} onChoose={() => {}} />);

    open();
    fireEvent.click(screen.getByRole("menuitemradio", { name: /online/i }));

    expect(screen.queryByRole("menuitemradio")).not.toBeInTheDocument();
  });
});
