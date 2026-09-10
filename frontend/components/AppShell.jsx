"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { FiX } from "react-icons/fi";
import { useTheme } from "../hooks/useTheme";
import { glyph, navItems } from "./constants";
import { Topbar } from "./Topbar";

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

export function AppShell({ children, initialTheme = "dark" }) {
  const [menu, setMenu] = useState(false);
  const { theme, toggleTheme } = useTheme(initialTheme);
  const menuButtonRef = useRef(null);
  const menuCloseButtonRef = useRef(null);
  const wasMenuOpenRef = useRef(false);
  const pathname = usePathname();
  const studio = pathname === "/studio";
  const auth = pathname === "/login" || pathname === "/register";

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
