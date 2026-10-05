import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationBell } from "../components/NotificationBell";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  getNotifications: vi.fn(),
  getNotificationUnreadCount: vi.fn(),
  markNotificationRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("../hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ user: { id: "me" }, isAuthenticated: true, isLoading: false }),
}));
vi.mock("../lib/api", () => ({
  api: {
    getNotifications: mocks.getNotifications,
    getNotificationUnreadCount: mocks.getNotificationUnreadCount,
    markNotificationRead: mocks.markNotificationRead,
    markAllNotificationsRead: mocks.markAllNotificationsRead,
  },
  fallbackCategories: vi.fn(() => []),
  fallbackGame: vi.fn(),
  fallbackGames: vi.fn(() => ({ items: [] })),
  fallbackPosts: vi.fn(() => []),
}));

const like = {
  id: "n1",
  type: "POST_LIKED",
  entityType: "POST",
  entityId: "post-1",
  readAt: null,
  createdAt: new Date().toISOString(),
  actor: { id: "a1", name: "Rover", image: null },
};
const message = {
  id: "n2",
  type: "MESSAGE_RECEIVED",
  entityType: "MESSAGE",
  entityId: "m1",
  readAt: "2026-10-01T00:00:00.000Z",
  createdAt: new Date().toISOString(),
  actor: { id: "a2", name: "Mado", image: null },
};

const follow = {
  id: "n3",
  type: "USER_FOLLOWED",
  entityType: "USER",
  entityId: "a3",
  readAt: null,
  createdAt: new Date().toISOString(),
  actor: { id: "a3", name: "Sora", image: null },
};

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <NotificationBell onClose={() => setOpen(false)} onToggle={() => setOpen((v) => !v)} open={open} />
  );
}

function renderBell() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
  );
}

const openDrawer = async () => {
  fireEvent.click(screen.getByRole("button", { name: /^Notifications/ }));
  return screen.findByRole("dialog", { name: "Notifications" });
};

describe("NotificationBell", () => {
  beforeEach(() => {
    mocks.push.mockReset();
    mocks.getNotifications.mockReset().mockResolvedValue({ items: [like, message], nextCursor: null, hasMore: false });
    mocks.getNotificationUnreadCount.mockReset().mockResolvedValue({ count: 1 });
    mocks.markNotificationRead.mockReset().mockResolvedValue({});
    mocks.markAllNotificationsRead.mockReset().mockResolvedValue({ updatedCount: 1 });
  });

  it("shows the real unread count on the bell", async () => {
    renderBell();

    expect(await screen.findByRole("button", { name: "Notifications, 1 unread" })).toBeInTheDocument();
  });

  it("lists real notifications with who did what", async () => {
    renderBell();
    await openDrawer();

    expect(await screen.findByText("liked your post")).toBeInTheDocument();
    expect(screen.getByText("Rover")).toBeInTheDocument();
    expect(screen.getByText("sent you a message")).toBeInTheDocument();
  });

  it("does not fetch the list until the drawer is opened", async () => {
    renderBell();
    await screen.findByRole("button", { name: "Notifications, 1 unread" });

    expect(mocks.getNotifications).not.toHaveBeenCalled();
  });

  it("marks an unread notification read, closes, and opens what it points at", async () => {
    renderBell();
    await openDrawer();

    fireEvent.click(await screen.findByText("liked your post"));

    await waitFor(() => expect(mocks.markNotificationRead).toHaveBeenCalledWith("n1"));
    expect(mocks.push).toHaveBeenCalledWith("/post/post-1");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("does not mark an already-read notification again", async () => {
    renderBell();
    await openDrawer();

    fireEvent.click(await screen.findByText("sent you a message"));

    expect(mocks.push).toHaveBeenCalledWith("/chat");
    expect(mocks.markNotificationRead).not.toHaveBeenCalled();
  });

  it("marks everything read", async () => {
    renderBell();
    await openDrawer();
    await screen.findByText("liked your post");

    fireEvent.click(screen.getByRole("button", { name: "Mark all read" }));

    await waitFor(() => expect(mocks.markAllNotificationsRead).toHaveBeenCalled());
  });

  it("shows an empty state", async () => {
    mocks.getNotifications.mockResolvedValue({ items: [], nextCursor: null, hasMore: false });
    renderBell();
    await openDrawer();

    expect(await screen.findByText("No notifications yet.")).toBeInTheDocument();
  });

  it("shows an error and retries", async () => {
    // The list query retries once on its own, so it takes two failures to surface an error.
    mocks.getNotifications
      .mockRejectedValueOnce(new Error("boom"))
      .mockRejectedValueOnce(new Error("boom"));
    renderBell();
    await openDrawer();

    expect(await screen.findByRole("alert", {}, { timeout: 4000 })).toHaveTextContent(
      "Couldn't load notifications.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("liked your post")).toBeInTheDocument();
  });

  it("loads the next page with the cursor", async () => {
    mocks.getNotifications
      .mockResolvedValueOnce({ items: [like], nextCursor: "n1", hasMore: true })
      .mockResolvedValueOnce({ items: [message], nextCursor: null, hasMore: false });
    renderBell();
    await openDrawer();
    await screen.findByText("liked your post");

    fireEvent.click(screen.getByRole("button", { name: "Load more" }));

    expect(await screen.findByText("sent you a message")).toBeInTheDocument();
    expect(mocks.getNotifications).toHaveBeenLastCalledWith(
      { limit: 20, cursor: "n1" },
      expect.anything(),
    );
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });

  it("patches the clicked row in place instead of refetching every loaded page", async () => {
    renderBell();
    await openDrawer();
    await screen.findByText("liked your post");
    expect(mocks.getNotifications).toHaveBeenCalledTimes(1);
    const countCalls = mocks.getNotificationUnreadCount.mock.calls.length;

    fireEvent.click(screen.getByText("liked your post"));

    await waitFor(() =>
      expect(mocks.getNotificationUnreadCount.mock.calls.length).toBeGreaterThan(countCalls),
    );
    expect(mocks.getNotifications).toHaveBeenCalledTimes(1);
  });

  it("turns every row read straight away on Mark all read", async () => {
    mocks.getNotifications.mockResolvedValue({ items: [like, follow], nextCursor: null, hasMore: false });
    renderBell();
    await openDrawer();
    await screen.findByText("liked your post");
    expect(document.querySelectorAll(".notification-row.unread")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Mark all read" }));

    await waitFor(() => expect(document.querySelectorAll(".notification-row.unread")).toHaveLength(0));
    expect(mocks.getNotifications).toHaveBeenCalledTimes(1);
  });

  it("keeps the drawer open and marks read when an unread row has nowhere to go", async () => {
    mocks.getNotifications.mockResolvedValue({ items: [follow], nextCursor: null, hasMore: false });
    renderBell();
    await openDrawer();

    fireEvent.click(await screen.findByText("followed you"));

    await waitFor(() => expect(mocks.markNotificationRead).toHaveBeenCalledWith("n3"));
    expect(mocks.push).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Notifications" })).toBeInTheDocument();
    await waitFor(() => expect(document.querySelector(".notification-row.unread")).toBeNull());
  });

  it("does not make a read row with nowhere to go a button", async () => {
    mocks.getNotifications.mockResolvedValue({
      items: [{ ...follow, readAt: "2026-10-01T00:00:00.000Z" }],
      nextCursor: null,
      hasMore: false,
    });
    renderBell();
    await openDrawer();
    await screen.findByText("followed you");

    expect(screen.queryByRole("button", { name: /followed you/ })).not.toBeInTheDocument();
  });
});
