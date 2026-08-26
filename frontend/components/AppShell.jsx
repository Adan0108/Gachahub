"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FiBell, FiMenu, FiMoon, FiPlus, FiSearch, FiSun, FiX } from "react-icons/fi";
import { api, fallbackGames, fallbackPosts } from "../lib/api";
import { queries } from "../lib/queries";
import { glyph, navItems } from "./constants";

function Logo() {
  return (
    <Link href="/" className="brand">
      <span className="brand-mark">{glyph.sparkle}</span>
      <b>GachaHub</b>
      <em>AI</em>
    </Link>
  );
}

function Sidebar({ open, close, onNotice }) {
  const pathname = usePathname();

  return (
    <>
      <div aria-hidden="true" className={`scrim ${open ? "show" : ""}`} onClick={close} />
      <aside aria-label="Primary navigation" className={`sidebar ${open ? "open" : ""}`}>
        <button aria-label="Close menu" className="mobile-close" onClick={close} type="button">
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
          <button onClick={() => onNotice("Upgrade is not available yet")} type="button">
            Upgrade Now
          </button>
        </div>
      </aside>
    </>
  );
}

function Topbar({ onMenu, onNotice, theme, onToggleTheme }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const searchInputRef = useRef(null);
  const blurTimerRef = useRef(null);
  const health = useQuery(queries.health());
  const apiStatus = health.isSuccess ? "connected" : health.isError ? "offline" : "checking";
  const search = query.trim();
  const gameSuggestions = useQuery({
    ...queries.games(search),
    enabled: focused && Boolean(search),
  });
  const canUseLocalSearch = api.usingMocks;
  const suggestedGames = search
    ? (gameSuggestions.data?.items || (canUseLocalSearch ? fallbackGames(search).items : [])).slice(
        0,
        3,
      )
    : [];
  const suggestedPosts = search && canUseLocalSearch ? fallbackPosts({ search }).slice(0, 2) : [];
  const suggestionsOpen = Boolean(
    focused &&
    search &&
    (suggestedGames.length ||
      suggestedPosts.length ||
      gameSuggestions.isLoading ||
      gameSuggestions.isError),
  );

  const submit = (event) => {
    event.preventDefault();
    router.push(search ? `/explore?q=${encodeURIComponent(search)}` : "/explore");
    setFocused(false);
  };

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
    router.push(`/community/${encodeURIComponent(slug)}`);
  };

  const openPostSearch = (title) => {
    setFocused(false);
    router.push(`/explore?q=${encodeURIComponent(title)}`);
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

  return (
    <header className="topbar">
      <button aria-label="Open menu" className="menu-btn" onClick={onMenu} type="button">
        <FiMenu />
      </button>
      <div className="search-wrap">
        <form className="search" onSubmit={submit}>
          <FiSearch />
          <input
            aria-label="Search GachaHub"
            aria-keyshortcuts="Control+K Meta+K"
            ref={searchInputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onFocus={focusSearch}
            onBlur={delayCloseSuggestions}
            placeholder="Search games, characters, posts..."
          />
        </form>
        {suggestionsOpen && (
          <div className="search-suggestions" aria-label="Search suggestions">
            {gameSuggestions.isLoading && (
              <div className="search-empty">Searching communities...</div>
            )}
            {gameSuggestions.isError && !canUseLocalSearch && (
              <div className="search-empty">
                Search needs the backend. Try again when the API is connected.
              </div>
            )}
            {suggestedGames.map((game) => (
              <button
                key={game.slug}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => openCommunity(game.slug)}
              >
                <span>{game.symbol}</span>
                <div>
                  <b>{game.name}</b>
                  <small>{game.members} members</small>
                </div>
              </button>
            ))}
            {suggestedPosts.map((post) => (
              <button
                key={post.id}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => openPostSearch(post.title)}
              >
                <span>#</span>
                <div>
                  <b>{post.title}</b>
                  <small>{post.gameName}</small>
                </div>
              </button>
            ))}
            {!gameSuggestions.isLoading &&
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
        <button
          className="icon-btn notification-btn"
          aria-label="Notifications"
          onClick={() => onNotice("Notifications are not available yet")}
          type="button"
        >
          <FiBell />
          <i />
        </button>
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

export function AppShell({ children }) {
  const [menu, setMenu] = useState(false);
  const [notice, setNotice] = useState("");
  const [theme, setTheme] = useState(() => {
    if (typeof window === "undefined") return "dark";

    const savedTheme = window.localStorage.getItem("gachahub-theme");
    if (savedTheme === "dark" || savedTheme === "light") return savedTheme;

    const prefersLight = window.matchMedia("(prefers-color-scheme: light)").matches;
    return prefersLight ? "light" : "dark";
  });
  const noticeTimerRef = useRef(null);
  const pathname = usePathname();
  const studio = pathname === "/studio";
  const auth = pathname === "/login" || pathname === "/register";

  const flashNotice = (message) => {
    window.clearTimeout(noticeTimerRef.current);
    setNotice(message);
    noticeTimerRef.current = window.setTimeout(() => setNotice(""), 1800);
  };

  const toggleTheme = () => {
    setTheme((current) => {
      const nextTheme = current === "dark" ? "light" : "dark";
      window.localStorage.setItem("gachahub-theme", nextTheme);
      return nextTheme;
    });
  };

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => () => window.clearTimeout(noticeTimerRef.current), []);

  if (auth) {
    return (
      <div className="auth-shell">
        <div className="toast-slot" aria-live="polite">
          {notice}
        </div>
        {children}
      </div>
    );
  }

  return (
    <div className={`app-shell ${studio ? "studio-shell" : ""}`}>
      <div className="toast-slot" aria-live="polite">
        {notice}
      </div>
      <Sidebar open={menu} close={() => setMenu(false)} onNotice={flashNotice} />
      <div className="main-column">
        {!studio && (
          <Topbar
            onMenu={() => setMenu(true)}
            onNotice={flashNotice}
            theme={theme}
            onToggleTheme={toggleTheme}
          />
        )}
        {children}
      </div>
    </div>
  );
}
