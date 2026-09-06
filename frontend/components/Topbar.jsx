"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FiBell, FiLogOut, FiMenu, FiMoon, FiPlus, FiSun, FiUser } from "react-icons/fi";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { api } from "../lib/api";
import { queries, queryKeys } from "../lib/queries";
import { glyph } from "./constants";
import { GlobalSearch } from "./GlobalSearch";

const notifications = [
  {
    id: "build-like",
    title: "Your Sanhua build is trending",
    detail: "12 new reactions in Wuthering Waves",
    href: "/profile",
    time: "8m",
  },
  {
    id: "lore-reply",
    title: "New reply in The Lament",
    detail: "LoreSeeker added a source to the theory",
    href: "/lore",
    time: "32m",
  },
  {
    id: "summary-ready",
    title: "Community digest is ready",
    detail: "Three new trends were summarized",
    href: "/summaries",
    time: "1h",
  },
];

export function Topbar({ menuButtonRef, onMenu, theme, onToggleTheme }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [readNotifications, setReadNotifications] = useState([]);
  const notificationButtonRef = useRef(null);
  const notificationDrawerRef = useRef(null);
  const wasNotificationsOpenRef = useRef(false);
  const accountButtonRef = useRef(null);
  const accountMenuRef = useRef(null);
  const health = useQuery(queries.health());
  const { user, isAuthenticated, isLoading: isSessionLoading } = useCurrentUser();
  const apiStatus = health.isSuccess ? "connected" : health.isError ? "offline" : "checking";
  const unreadCount = notifications.filter((item) => !readNotifications.includes(item.id)).length;
  const initials = (user?.name || user?.email || "User")
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const logout = useMutation({
    mutationFn: api.signOut,
    onSuccess: () => {
      queryClient.setQueryData(queryKeys.currentUser, null);
      setAccountOpen(false);
      router.push("/");
    },
  });

  const openNotification = (notification) => {
    setReadNotifications((current) => [...new Set([...current, notification.id])]);
    setNotificationsOpen(false);
    router.push(notification.href);
  };

  useEffect(() => {
    if (!notificationsOpen) return undefined;
    wasNotificationsOpenRef.current = true;
    notificationDrawerRef.current?.querySelector("button")?.focus();
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setNotificationsOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [notificationsOpen]);

  useEffect(() => {
    if (!accountOpen) return undefined;

    const closeAccountMenu = (event) => {
      if (event.key === "Escape") {
        setAccountOpen(false);
        accountButtonRef.current?.focus();
      }
      if (
        event.type === "mousedown" &&
        !accountMenuRef.current?.contains(event.target) &&
        !accountButtonRef.current?.contains(event.target)
      ) {
        setAccountOpen(false);
      }
    };

    window.addEventListener("keydown", closeAccountMenu);
    window.addEventListener("mousedown", closeAccountMenu);
    return () => {
      window.removeEventListener("keydown", closeAccountMenu);
      window.removeEventListener("mousedown", closeAccountMenu);
    };
  }, [accountOpen]);

  useEffect(() => {
    if (!notificationsOpen && wasNotificationsOpenRef.current) {
      notificationButtonRef.current?.focus();
      wasNotificationsOpenRef.current = false;
    }
  }, [notificationsOpen]);

  return (
    <header className="topbar">
      <button
        aria-label="Open menu"
        className="menu-btn"
        onClick={onMenu}
        ref={menuButtonRef}
        type="button"
      >
        <FiMenu />
      </button>
      <GlobalSearch />
      <div className="top-actions">
        <span className={`api-status ${apiStatus}`} title={`Backend: ${api.baseUrl}`}>
          <i />{" "}
          {apiStatus === "connected"
            ? "Backend connected"
            : apiStatus === "offline"
              ? "Offline mode"
              : "Checking API"}
        </span>
        <button className="outline-btn" onClick={() => router.push("/studio")} type="button">
          <FiPlus /> <span>Create</span>
        </button>
        <button
          className="icon-btn theme-toggle"
          aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          onClick={onToggleTheme}
          type="button"
        >
          {theme === "dark" ? <FiSun /> : <FiMoon />}
        </button>
        {!isSessionLoading && !isAuthenticated && (
          <Link className="auth-top-link" href="/login">
            Log in
          </Link>
        )}
        {isSessionLoading && <span className="auth-session-placeholder" aria-hidden="true" />}
        {isAuthenticated && (
          <div className="notification-wrap">
            <button
              aria-expanded={notificationsOpen}
              aria-haspopup="dialog"
              className="icon-btn notification-btn"
              aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ""}`}
              onClick={() => setNotificationsOpen((current) => !current)}
              ref={notificationButtonRef}
              type="button"
            >
              <FiBell />
              {unreadCount > 0 && <i />}
            </button>
            {notificationsOpen && (
              <section
                aria-label="Notifications"
                className="notification-drawer"
                ref={notificationDrawerRef}
                role="dialog"
              >
                <div className="notification-head">
                  <div>
                    <span className="eyebrow">Inbox</span>
                    <b>Notifications</b>
                  </div>
                  <button
                    disabled={!unreadCount}
                    onClick={() => setReadNotifications(notifications.map((item) => item.id))}
                    type="button"
                  >
                    Mark all read
                  </button>
                </div>
                <div className="notification-list">
                  {notifications.map((notification) => (
                    <button
                      className={readNotifications.includes(notification.id) ? "read" : "unread"}
                      key={notification.id}
                      onClick={() => openNotification(notification)}
                      type="button"
                    >
                      <span>{glyph.sparkle}</span>
                      <div>
                        <b>{notification.title}</b>
                        <small>{notification.detail}</small>
                      </div>
                      <time>{notification.time}</time>
                    </button>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
        {isAuthenticated && (
          <div className="account-wrap">
            <button
              aria-expanded={accountOpen}
              aria-haspopup="menu"
              aria-label="Open account menu"
              className="mini-avatar"
              onClick={() => setAccountOpen((current) => !current)}
              ref={accountButtonRef}
              type="button"
            >
              {initials}
            </button>
            {accountOpen && (
              <div className="user-menu" ref={accountMenuRef} role="menu">
                <div className="user-menu-profile">
                  <b>{user.name || "GachaHub user"}</b>
                  <small>{user.email}</small>
                </div>
                <Link href="/profile" onClick={() => setAccountOpen(false)} role="menuitem">
                  <FiUser /> View profile
                </Link>
                <button
                  disabled={logout.isPending}
                  onClick={() => logout.mutate()}
                  role="menuitem"
                  type="button"
                >
                  <FiLogOut /> {logout.isPending ? "Logging out..." : "Log out"}
                </button>
                {logout.isError && <small className="user-menu-error">Unable to log out.</small>}
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
