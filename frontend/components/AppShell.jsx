"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
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

function Sidebar({ open, close }) {
  const pathname = usePathname();

  return (
    <>
      <div className={`scrim ${open ? "show" : ""}`} onClick={close} />
      <aside className={`sidebar ${open ? "open" : ""}`}>
        <button className="mobile-close" onClick={close} type="button"><FiX /></button>
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
          <button type="button">Upgrade Now</button>
        </div>
      </aside>
    </>
  );
}

function Topbar({ onMenu }) {
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
      <button className="menu-btn" onClick={onMenu} type="button"><FiMenu /></button>
      <form className="search" onSubmit={submit}>
        <FiSearch />
        <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search games, characters, posts..." />
        <kbd>Ctrl K</kbd>
      </form>
      <div className="top-actions">
        <span className={`api-status ${apiStatus}`} title={`Backend: ${api.baseUrl}`}>
          <i /> {apiStatus === "connected" ? "Backend connected" : apiStatus === "offline" ? "Offline mode" : "Checking API"}
        </span>
        <button className="outline-btn" onClick={() => router.push("/studio")} type="button"><FiPlus /> <span>Create</span></button>
        <button className="icon-btn" aria-label="Notifications" type="button"><FiBell /><i /></button>
        <button className="mini-avatar" onClick={() => router.push("/profile")} type="button">R</button>
      </div>
    </header>
  );
}

export function AppShell({ children }) {
  const [menu, setMenu] = useState(false);
  const pathname = usePathname();
  const studio = pathname === "/studio";

  return (
    <div className={`app-shell ${studio ? "studio-shell" : ""}`}>
      <Sidebar open={menu} close={() => setMenu(false)} />
      <div className="main-column">
        {!studio && <Topbar onMenu={() => setMenu(true)} />}
        {children}
      </div>
    </div>
  );
}
