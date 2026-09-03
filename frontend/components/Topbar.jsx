"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FiBell, FiMenu, FiMoon, FiPlus, FiSun } from "react-icons/fi";
import { api } from "../lib/api";
import { queries } from "../lib/queries";
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
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [readNotifications, setReadNotifications] = useState([]);
  const notificationButtonRef = useRef(null);
  const notificationDrawerRef = useRef(null);
  const wasNotificationsOpenRef = useRef(false);
  const health = useQuery(queries.health());
  const apiStatus = health.isSuccess ? "connected" : health.isError ? "offline" : "checking";
  const unreadCount = notifications.filter((item) => !readNotifications.includes(item.id)).length;

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
        <Link className="auth-top-link" href="/login">
          Log in
        </Link>
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
        <button
          aria-label="Open profile"
          className="mini-avatar"
          onClick={() => router.push("/profile")}
          type="button"
        >
          R
        </button>
      </div>
    </header>
  );
}
