"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  FiBell,
  FiMenu,
  FiPlus,
  FiSearch,
  FiX,
} from "react-icons/fi";
import { api } from "../lib/api";
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
        <button aria-label="Close menu" className="mobile-close" onClick={close} type="button"><FiX /></button>
        <Logo />
        <nav className="side-nav">
          {navItems.map(({ href, icon: Icon, label, exact, match }) => {
            const active = exact ? pathname === href : pathname === href || pathname.startsWith(match || href);
            return (
              <Link key={href} href={href} onClick={close} className={active ? "active" : ""}>
                <Icon /><span>{label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="side-label">FAVORITES</div>
        <div className="favorites">
          <Link href="/community/wuthering-waves" onClick={close}>{glyph.dot} <span>Wuthering Waves</span></Link>
          <Link href="/community/honkai-star-rail" onClick={close}>{glyph.sparkle} <span>Honkai: Star Rail</span></Link>
          <Link href="/community/genshin-impact" onClick={close}>{glyph.star} <span>Genshin Impact</span></Link>
        </div>
        <div className="pro-card">
          <div className="pro-gem">{glyph.diamond}</div>
          <b>GachaHub AI Pro</b>
          <p>Exclusive AI tools, premium build cards, and smarter summaries.</p>
          <button onClick={() => onNotice("Upgrade is not available yet")} type="button">Upgrade Now</button>
        </div>
      </aside>
    </>
  );
}

function Topbar({ onMenu, onNotice }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const health = useQuery(queries.health());
  const apiStatus = health.isSuccess ? "connected" : health.isError ? "offline" : "checking";

  const submit = event => {
    event.preventDefault();
    const search = query.trim();
    router.push(search ? `/explore?q=${encodeURIComponent(search)}` : "/explore");
  };

  return (
    <header className="topbar">
      <button aria-label="Open menu" className="menu-btn" onClick={onMenu} type="button"><FiMenu /></button>
      <form className="search" onSubmit={submit}>
        <FiSearch />
        <input aria-label="Search GachaHub" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search games, characters, posts..." />
        <kbd>Ctrl K</kbd>
      </form>
      <div className="top-actions">
        <span className={`api-status ${apiStatus}`} title={`Backend: ${api.baseUrl}`}>
          <i /> {apiStatus === "connected" ? "Backend connected" : apiStatus === "offline" ? "Offline mode" : "Checking API"}
        </span>
        <button className="outline-btn" onClick={() => router.push("/studio")} type="button"><FiPlus /> <span>Create</span></button>
        <button className="icon-btn" aria-label="Notifications" onClick={() => onNotice("Notifications are not available yet")} type="button"><FiBell /><i /></button>
        <button aria-label="Open profile" className="mini-avatar" onClick={() => router.push("/profile")} type="button">R</button>
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

  const flashNotice = message => {
    window.clearTimeout(noticeTimerRef.current);
    setNotice(message);
    noticeTimerRef.current = window.setTimeout(() => setNotice(""), 1800);
  };

  useEffect(() => () => window.clearTimeout(noticeTimerRef.current), []);

  return (
    <div className={`app-shell ${studio ? "studio-shell" : ""}`}>
      <div className="toast-slot" aria-live="polite">{notice}</div>
      <Sidebar open={menu} close={() => setMenu(false)} onNotice={flashNotice} />
      <div className="main-column">
        {!studio && <Topbar onMenu={() => setMenu(true)} onNotice={flashNotice} />}
        {children}
      </div>
    </div>
  );
}
