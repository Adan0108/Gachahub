"use client";

import { useRouter } from "next/navigation";
import { useNowTick } from "../hooks/useNowTick";
import { describeNotification } from "../lib/notifications/describeNotification";
import { relativeTime } from "../lib/time";
import { AvatarFace } from "./AvatarFace";

/** The open notification list; mounted only while open, so the clock below ticks only when seen. */
export function NotificationDrawer({ notifications, drawerRef, onClose }) {
  const router = useRouter();
  const { unreadCount, items, list, markRead, markAllRead } = notifications;
  // Keeps "2m ago" honest while the drawer sits open.
  useNowTick(60_000);

  const openNotification = (notification, href) => {
    if (!notification.readAt) markRead.mutate(notification.id);
    // Nowhere to go: the row just turns read, and the drawer stays open instead of dismissing itself.
    if (!href) return;
    onClose();
    router.push(href);
  };

  return (
    <section aria-label="Notifications" className="notification-drawer" ref={drawerRef} role="dialog">
      <div className="notification-head">
        <div>
          <span className="eyebrow">Inbox</span>
          <b>Notifications</b>
        </div>
        <button
          disabled={!unreadCount || markAllRead.isPending}
          onClick={() => markAllRead.mutate()}
          type="button"
        >
          Mark all read
        </button>
      </div>
      {list.isLoading && <p className="notification-status">Loading notifications...</p>}
      {list.isError && (
        <p className="notification-status" role="alert">
          Couldn&apos;t load notifications.{" "}
          <button onClick={() => list.refetch()} type="button">
            Try again
          </button>
        </p>
      )}
      {!list.isLoading && !list.isError && items.length === 0 && (
        <p className="notification-status">No notifications yet.</p>
      )}
      <div className="notification-list">
        {items.map((notification) => {
          const { actor, action, href } = describeNotification(notification);
          const className = `notification-row ${notification.readAt ? "read" : "unread"}`;
          const body = (
            <>
              <span className="notification-avatar">
                <AvatarFace image={notification.actor?.image} name={actor} />
              </span>
              <div>
                <b>{actor}</b>
                <small>{action}</small>
              </div>
              <time dateTime={notification.createdAt}>{relativeTime(notification.createdAt)}</time>
            </>
          );

          // Read and nowhere to go: there is nothing a click could do, so it isn't a button.
          if (!href && notification.readAt) {
            return (
              <div className={className} key={notification.id}>
                {body}
              </div>
            );
          }

          return (
            <button
              className={className}
              key={notification.id}
              onClick={() => openNotification(notification, href)}
              type="button"
            >
              {body}
            </button>
          );
        })}
      </div>
      {list.hasNextPage && (
        <button
          className="notification-more"
          disabled={list.isFetchingNextPage}
          onClick={() => list.fetchNextPage()}
          type="button"
        >
          {list.isFetchingNextPage ? "Loading..." : "Load more"}
        </button>
      )}
    </section>
  );
}
