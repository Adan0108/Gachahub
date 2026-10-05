"use client";

import { useRef } from "react";
import { FiBell } from "react-icons/fi";
import { useDismiss } from "../hooks/useDismiss";
import { useNotifications } from "../hooks/useNotifications";
import { NotificationDrawer } from "./NotificationDrawer";

/** The top-bar bell; open state lives in the parent so it can close its sibling menu. */
export function NotificationBell({ open, onToggle, onClose }) {
  const buttonRef = useRef(null);
  const drawerRef = useRef(null);
  const notifications = useNotifications({ listEnabled: open });

  useDismiss({ isOpen: open, onDismiss: onClose, contentRef: drawerRef, triggerRef: buttonRef });

  return (
    <div className="notification-wrap">
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`Notifications${notifications.unreadCount ? `, ${notifications.unreadCount} unread` : ""}`}
        className="icon-btn notification-btn"
        onClick={onToggle}
        ref={buttonRef}
        type="button"
      >
        <FiBell />
        {notifications.unreadCount > 0 && <i />}
      </button>
      {open && (
        <NotificationDrawer
          drawerRef={drawerRef}
          notifications={notifications}
          onClose={onClose}
        />
      )}
    </div>
  );
}
