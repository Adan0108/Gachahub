"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { FiX } from "react-icons/fi";
import { useTheme } from "../hooks/useTheme";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { mustOnboard } from "../lib/username";
import { useDeviceIdentity } from "../hooks/chat/useDeviceIdentity";
import { useAppSocket } from "../hooks/useAppSocket";
import { useChatSocket } from "../hooks/chat/useChatSocket";
import { useNotificationSocket } from "../hooks/useNotificationSocket";
import { BrandMark } from "./BrandMark";
import { glyph, navItems } from "./constants";
import { DevToolsPanel } from "./DevToolsPanel";
import { Topbar } from "./Topbar";

function Logo() {
  return (
    <Link href="/" className="brand">
      <BrandMark size={29} />
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
              <Link
                aria-current={active ? "page" : undefined}
                key={href}
                href={href}
                onClick={close}
                className={active ? "active" : ""}
              >
                {active && <span className="sr-only">Current page:</span>}
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
  // Provisions this browser device's MLS identity once signed in - runs
  // app-wide so it's ready before the user ever opens chat, not just when
  // they land on it. useDeviceIdentity no-ops until useCurrentUser resolves
  // an authenticated user, so this is harmless on /login and /register too.
  useDeviceIdentity();
  // The one live connection, app-wide. Each feature below attaches only its own listeners to it.
  useAppSocket();
  // Live push for new messages app-wide, same reasoning as useDeviceIdentity
  // above - so a message shows up immediately even on a page other than
  // /chat, not just once the poll interval there happens to fire.
  useChatSocket();
  // Keeps the top-bar bell live on every page.
  useNotificationSocket();
  const router = useRouter();
  const menuButtonRef = useRef(null);
  const menuCloseButtonRef = useRef(null);
  const wasMenuOpenRef = useRef(false);
  const pathname = usePathname();
  const studio = pathname === "/studio";
  const onboarding = pathname === "/onboarding";
  const auth = pathname === "/login" || pathname === "/register" || onboarding;
  const admin = pathname.startsWith("/admin");
  const chat = pathname.startsWith("/chat");
  const { user, isAuthenticated, isLoading: isSessionLoading } = useCurrentUser();

  // Global one-time onboarding gate (mounted once here, so it covers every route); /admin is exempt since AdminShell has its own useRequireAdmin gate, and `=== false` (not `!user?.onboarded`) fails open on a missing/unexpected field instead of trapping every signed-in user here.
  useEffect(() => {
    if (isSessionLoading || !isAuthenticated || onboarding || admin) return;
    if (mustOnboard(user)) router.replace("/onboarding");
  }, [admin, isAuthenticated, isSessionLoading, onboarding, router, user]);

  useEffect(() => {
    if (menu) {
      wasMenuOpenRef.current = true;
      const previousOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      menuCloseButtonRef.current?.focus();
      const closeOnEscape = (event) => {
        if (event.key === "Escape") setMenu(false);
      };
      window.addEventListener("keydown", closeOnEscape);
      return () => {
        document.body.style.overflow = previousOverflow;
        window.removeEventListener("keydown", closeOnEscape);
      };
    }

    if (wasMenuOpenRef.current) {
      menuButtonRef.current?.focus();
      wasMenuOpenRef.current = false;
    }
    return undefined;
  }, [menu]);

  if (auth) {
    return (
      <div className="auth-shell">
        {children}
        {process.env.NODE_ENV !== "production" && <DevToolsPanel />}
      </div>
    );
  }

  if (admin) return children;

  return (
    <div className={`app-shell ${studio ? "studio-shell" : ""}`}>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <Sidebar open={menu} close={() => setMenu(false)} closeButtonRef={menuCloseButtonRef} />
      <div className="main-column">
        {!studio && (
          <Topbar
            menuButtonRef={menuButtonRef}
            onMenu={() => setMenu(true)}
            theme={theme}
            onToggleTheme={toggleTheme}
            showGlobalActions={!chat}
          />
        )}
        <div id="main-content" tabIndex={-1}>{children}</div>
      </div>
      {process.env.NODE_ENV !== "production" && <DevToolsPanel />}
    </div>
  );
}
