"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { FiBell, FiMenu, FiMoon, FiPlus, FiSearch, FiSun, FiX } from "react-icons/fi";
import { api, fallbackGames, fallbackPosts } from "../lib/api";
import { queries } from "../lib/queries";
import { glyph, navItems } from "./constants";

const THEME_STORAGE_KEY = "gachahub-theme";
const THEME_CHANGE_EVENT = "gachahub-theme-change";
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

function isTheme(value) {
  return value === "dark" || value === "light";
}

function getCookieTheme() {
  const themeCookie = document.cookie
    .split("; ")
    .find((cookie) => cookie.startsWith(`${THEME_STORAGE_KEY}=`));

  const cookieValue = themeCookie?.split("=")[1];
  const theme = cookieValue ? decodeURIComponent(cookieValue) : "";
  return isTheme(theme) ? theme : "";
}

function getPreferredTheme() {
  if (typeof window === "undefined") return "dark";

  const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (isTheme(savedTheme)) return savedTheme;

  const savedCookieTheme = getCookieTheme();
  if (savedCookieTheme) return savedCookieTheme;

  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function subscribeTheme(callback) {
  window.addEventListener("storage", callback);
  window.addEventListener(THEME_CHANGE_EVENT, callback);

  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(THEME_CHANGE_EVENT, callback);
  };
}

function useDebouncedValue(value, delay) {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedValue(value), delay);
    return () => window.clearTimeout(timer);
  }, [delay, value]);

  return debouncedValue;
}

function Logo() {
  return (
    <Link href="/" className="brand">
      <span className="brand-mark">{glyph.sparkle}</span>
      <b>GachaHub</b>
      <em>AI</em>
    </Link>
  );
}

function Sidebar({ open, close, closeButtonRef }) {
  const pathname = usePathname();

  return (
    <>
      <div aria-hidden="true" className={`scrim ${open ? "show" : ""}`} onClick={close} />
      <aside aria-label="Primary navigation" className={`sidebar ${open ? "open" : ""}`}>
        <button
          aria-label="Close menu"
          className="mobile-close"
          onClick={close}
          ref={closeButtonRef}
          type="button"
        >
          <FiX />
        </button>
        <Logo />
        <nav className="side-nav">
          {navItems.map(({ href, icon: Icon, label, exact, match }) => {
            const active = exact
              ? pathname === href
              : pathname === href || pathname.startsWith(match || href);
            return (
              <Link key={href} href={href} onClick={close} className={active ? "active" : ""}>
                <Icon />
                <span>{label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="side-label">FAVORITES</div>
        <div className="favorites">
          <Link href="/community/wuthering-waves" onClick={close}>
            {glyph.dot} <span>Wuthering Waves</span>
          </Link>
          <Link href="/community/honkai-star-rail" onClick={close}>
            {glyph.sparkle} <span>Honkai: Star Rail</span>
          </Link>
          <Link href="/community/genshin-impact" onClick={close}>
            {glyph.star} <span>Genshin Impact</span>
          </Link>
        </div>
        <div className="pro-card">
          <div className="pro-gem">{glyph.diamond}</div>
          <b>GachaHub AI Pro</b>
          <p>Exclusive AI tools, premium build cards, and smarter summaries.</p>
          <span className="pro-status">Early access coming soon</span>
        </div>
      </aside>
    </>
  );
}

function Topbar({ menuButtonRef, onMenu, theme, onToggleTheme }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [readNotifications, setReadNotifications] = useState([]);
  const searchInputRef = useRef(null);
  const blurTimerRef = useRef(null);
  const notificationButtonRef = useRef(null);
  const notificationDrawerRef = useRef(null);
  const wasNotificationsOpenRef = useRef(false);
  const health = useQuery(queries.health());
  const apiStatus = health.isSuccess ? "connected" : health.isError ? "offline" : "checking";
  const search = query.trim();
  const debouncedSearch = useDebouncedValue(search, 350);
  const canSearch = debouncedSearch.length >= 2;
  const gameSuggestions = useQuery({
    ...queries.games(debouncedSearch),
    enabled: focused && canSearch,
  });
  const canUseLocalSearch = api.usingMocks;
  const suggestedGames = canSearch
    ? (
        gameSuggestions.data?.items ||
        (canUseLocalSearch ? fallbackGames(debouncedSearch).items : [])
      ).slice(0, 3)
    : [];
  const suggestedPosts =
    canSearch && canUseLocalSearch ? fallbackPosts({ search: debouncedSearch }).slice(0, 2) : [];
  const suggestions = [
    ...suggestedGames.map((game) => ({ type: "community", value: game })),
    ...suggestedPosts.map((post) => ({ type: "post", value: post })),
  ];
  const suggestionsOpen = focused && Boolean(search);
  const activeSuggestionId = suggestions[activeSuggestion]
    ? `search-suggestion-${suggestions[activeSuggestion].type}-${suggestions[activeSuggestion].value.id}`
    : undefined;
  const unreadCount = notifications.filter((item) => !readNotifications.includes(item.id)).length;

  const delayCloseSuggestions = () => {
    window.clearTimeout(blurTimerRef.current);
    blurTimerRef.current = window.setTimeout(() => setFocused(false), 120);
  };

  const focusSearch = useCallback(() => {
    window.clearTimeout(blurTimerRef.current);
    setFocused(true);
    searchInputRef.current?.focus();
  }, []);

  const openCommunity = (slug) => {
    setFocused(false);
    setActiveSuggestion(-1);
    router.push(`/community/${encodeURIComponent(slug)}`);
  };

  const openPostSearch = (title) => {
    setFocused(false);
    setActiveSuggestion(-1);
    router.push(`/explore?q=${encodeURIComponent(title)}`);
  };

  const openSuggestion = (suggestion) => {
    if (suggestion.type === "community") openCommunity(suggestion.value.slug);
    else openPostSearch(suggestion.value.title);
  };

  const submit = (event) => {
    event.preventDefault();
    const selectedSuggestion = suggestions[activeSuggestion];
    if (selectedSuggestion) {
      openSuggestion(selectedSuggestion);
      return;
    }

    router.push(search ? `/explore?q=${encodeURIComponent(search)}` : "/explore");
    setFocused(false);
    setActiveSuggestion(-1);
  };

  const handleSearchKeyDown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setFocused(false);
      setActiveSuggestion(-1);
      return;
    }

    if (!suggestions.length || (event.key !== "ArrowDown" && event.key !== "ArrowUp")) return;

    event.preventDefault();
    const direction = event.key === "ArrowDown" ? 1 : -1;
    setActiveSuggestion((current) => {
      if (current === -1) return direction === 1 ? 0 : suggestions.length - 1;
      return (current + direction + suggestions.length) % suggestions.length;
    });
  };

  const openNotification = (notification) => {
    setReadNotifications((current) => [...new Set([...current, notification.id])]);
    setNotificationsOpen(false);
    router.push(notification.href);
  };

  useEffect(() => {
    const handleShortcut = (event) => {
      const isSearchShortcut = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k";
      if (!isSearchShortcut) return;

      event.preventDefault();
      focusSearch();
    };

    window.addEventListener("keydown", handleShortcut);

    return () => {
      window.removeEventListener("keydown", handleShortcut);
      window.clearTimeout(blurTimerRef.current);
    };
  }, [focusSearch]);

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
      <div className="search-wrap">
        <form className="search" onSubmit={submit}>
          <FiSearch />
          <input
            aria-activedescendant={activeSuggestionId}
            aria-autocomplete="list"
            aria-controls="global-search-suggestions"
            aria-expanded={suggestionsOpen}
            aria-label="Search GachaHub"
            aria-keyshortcuts="Control+K Meta+K"
            role="combobox"
            ref={searchInputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setFocused(true);
              setActiveSuggestion(-1);
            }}
            onFocus={focusSearch}
            onBlur={delayCloseSuggestions}
            onKeyDown={handleSearchKeyDown}
            placeholder="Search communities..."
          />
        </form>
        {suggestionsOpen && (
          <div
            className="search-suggestions"
            aria-label="Search suggestions"
            id="global-search-suggestions"
            role="listbox"
          >
            {!canSearch && <div className="search-empty">Enter at least 2 characters.</div>}
            {canSearch && gameSuggestions.isLoading && (
              <div className="search-empty">Searching communities...</div>
            )}
            {canSearch && gameSuggestions.isError && !canUseLocalSearch && (
              <div className="search-empty">
                Search needs the backend. Try again when the API is connected.
              </div>
            )}
            {suggestedGames.map((game, index) => (
              <button
                aria-selected={activeSuggestion === index}
                className={activeSuggestion === index ? "active" : ""}
                id={`search-suggestion-community-${game.id}`}
                key={game.slug}
                role="option"
                tabIndex={-1}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveSuggestion(index)}
                onClick={() => openCommunity(game.slug)}
              >
                <span>{game.symbol}</span>
                <div>
                  <b>{game.name}</b>
                  <small>{game.members} members</small>
                </div>
              </button>
            ))}
            {suggestedPosts.map((post, index) => {
              const resultIndex = suggestedGames.length + index;
              return (
                <button
                  aria-selected={activeSuggestion === resultIndex}
                  className={activeSuggestion === resultIndex ? "active" : ""}
                  id={`search-suggestion-post-${post.id}`}
                  key={post.id}
                  role="option"
                  tabIndex={-1}
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActiveSuggestion(resultIndex)}
                  onClick={() => openPostSearch(post.title)}
                >
                  <span>#</span>
                  <div>
                    <b>{post.title}</b>
                    <small>{post.gameName}</small>
                  </div>
                </button>
              );
            })}
            {canSearch &&
              !gameSuggestions.isLoading &&
              !gameSuggestions.isError &&
              !suggestedGames.length &&
              !suggestedPosts.length && (
                <div className="search-empty">No matches found. Press Enter to search.</div>
              )}
          </div>
        )}
      </div>
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

export function AppShell({ children, initialTheme = "dark" }) {
  const [menu, setMenu] = useState(false);
  const theme = useSyncExternalStore(subscribeTheme, getPreferredTheme, () => initialTheme);
  const menuButtonRef = useRef(null);
  const menuCloseButtonRef = useRef(null);
  const wasMenuOpenRef = useRef(false);
  const pathname = usePathname();
  const studio = pathname === "/studio";
  const auth = pathname === "/login" || pathname === "/register";

  const toggleTheme = () => {
    const nextTheme = theme === "dark" ? "light" : "dark";
    window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    document.cookie = `${THEME_STORAGE_KEY}=${nextTheme}; path=/; max-age=31536000; SameSite=Lax`;
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
  };

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    if (menu) {
      wasMenuOpenRef.current = true;
      menuCloseButtonRef.current?.focus();
      const closeOnEscape = (event) => {
        if (event.key === "Escape") setMenu(false);
      };
      window.addEventListener("keydown", closeOnEscape);
      return () => window.removeEventListener("keydown", closeOnEscape);
    }

    if (wasMenuOpenRef.current) {
      menuButtonRef.current?.focus();
      wasMenuOpenRef.current = false;
    }
    return undefined;
  }, [menu]);

  if (auth) {
    return <div className="auth-shell">{children}</div>;
  }

  return (
    <div className={`app-shell ${studio ? "studio-shell" : ""}`}>
      <Sidebar open={menu} close={() => setMenu(false)} closeButtonRef={menuCloseButtonRef} />
      <div className="main-column">
        {!studio && (
          <Topbar
            menuButtonRef={menuButtonRef}
            onMenu={() => setMenu(true)}
            theme={theme}
            onToggleTheme={toggleTheme}
          />
        )}
        {children}
      </div>
    </div>
  );
}
