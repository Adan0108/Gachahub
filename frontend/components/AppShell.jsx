"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FiBell, FiMenu, FiPlus, FiSearch, FiX } from "react-icons/fi";
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

function Topbar({ onMenu, onNotice }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const health = useQuery(queries.health());
  const apiStatus = health.isSuccess ? "connected" : health.isError ? "offline" : "checking";
  const search = query.trim();
  const suggestedGames = search ? fallbackGames(search).items.slice(0, 3) : [];
  const suggestedPosts = search ? fallbackPosts({ search }).slice(0, 2) : [];
  const suggestionsOpen = focused && search && (suggestedGames.length || suggestedPosts.length);

  const submit = (event) => {
    event.preventDefault();
    router.push(search ? `/explore?q=${encodeURIComponent(search)}` : "/explore");
    setFocused(false);
  };

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
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => window.setTimeout(() => setFocused(false), 120)}
            placeholder="Search games, characters, posts..."
          />
          <kbd>Ctrl K</kbd>
        </form>
        {suggestionsOpen && (
          <div className="search-suggestions" role="listbox" aria-label="Search suggestions">
            {suggestedGames.map((game) => (
              <button
                key={game.slug}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => router.push(`/community/${encodeURIComponent(game.slug)}`)}
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
                onClick={() => router.push(`/explore?q=${encodeURIComponent(post.title)}`)}
              >
                <span>#</span>
                <div>
                  <b>{post.title}</b>
                  <small>{post.gameName}</small>
                </div>
              </button>
            ))}
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
        <Link className="auth-top-link" href="/login">
          Log in
        </Link>
        <button
          className="icon-btn"
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
  const noticeTimerRef = useRef(null);
  const pathname = usePathname();
  const studio = pathname === "/studio";
  const auth = pathname === "/login" || pathname === "/register";

  const flashNotice = (message) => {
    window.clearTimeout(noticeTimerRef.current);
    setNotice(message);
    noticeTimerRef.current = window.setTimeout(() => setNotice(""), 1800);
  };

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
        {!studio && <Topbar onMenu={() => setMenu(true)} onNotice={flashNotice} />}
        {children}
      </div>
    </div>
  );
}
