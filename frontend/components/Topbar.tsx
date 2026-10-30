"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import type { Ref } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  FiHexagon,
  FiLogOut,
  FiMenu,
  FiMoon,
  FiPlus,
  FiSettings,
  FiSun,
  FiUser,
} from "react-icons/fi";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { useDismiss } from "../hooks/useDismiss";
import { useMyPresence, useOfflineExpiryNotice } from "../hooks/presence/useMyPresence";
import { useSignOut } from "../hooks/useSignOut";
import type { PresenceChange } from "./StatusMenu";
import { useToast } from "../hooks/useToast";
import { ModerationNavigation } from "./moderation/ModerationNavigation";
import { api } from "../lib/api";
import { queries } from "../lib/queries";
import { AvatarFace } from "./AvatarFace";
import { GlobalSearch } from "./GlobalSearch";
import { NotificationBell } from "./NotificationBell";
import { PresenceDot } from "./PresenceDot";
import { StatusMenu } from "./StatusMenu";

export function Topbar({
  menuButtonRef,
  onMenu,
  theme,
  onToggleTheme,
  showGlobalActions = true,
}: {
  menuButtonRef: Ref<HTMLButtonElement>;
  onMenu: () => void;
  theme: string;
  onToggleTheme: () => void;
  showGlobalActions?: boolean;
}) {
  const router = useRouter();
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const { notice, showNotice } = useToast(2200);
  const accountButtonRef = useRef(null);
  const accountMenuRef = useRef(null);
  const health = useQuery(queries.health());
  const { user, isAuthenticated, isLoading: isSessionLoading } = useCurrentUser();
  const wallet = useQuery({ ...queries.wallet(), enabled: isAuthenticated });
  const apiStatus = health.isSuccess ? "connected" : health.isError ? "offline" : "checking";
  const initials = (user?.name || user?.email || "User")
    .split(/\s+/)
    .map((part: string) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const logout = useSignOut({
    onSignedOut: () => {
      setAccountOpen(false);
      showNotice("Logged out successfully");
    },
  });

  const { me: myPresence, change: changePresence } = useMyPresence();
  useOfflineExpiryNotice(myPresence, showNotice);

  const closeNotifications = useCallback(() => setNotificationsOpen(false), []);
  const closeAccountMenu = useCallback(() => setAccountOpen(false), []);

  useDismiss({
    isOpen: accountOpen,
    onDismiss: closeAccountMenu,
    contentRef: accountMenuRef,
    triggerRef: accountButtonRef,
  });

  return (
    <header className="topbar">
      <div className="toast-slot topbar-toast" aria-live="polite">
        {notice}
      </div>
      <button
        aria-label="Open menu"
        className="menu-btn"
        onClick={onMenu}
        ref={menuButtonRef}
        type="button"
      >
        <FiMenu />
      </button>
      {showGlobalActions && <GlobalSearch />}
      <div className="top-actions">
        <span className={`api-status ${apiStatus}`} title={`Backend: ${api.baseUrl}`}>
          <i />{" "}
          {apiStatus === "connected"
            ? "Backend connected"
            : apiStatus === "offline"
              ? "Offline mode"
              : "Checking API"}
        </span>
        {showGlobalActions && (
          <button className="outline-btn" onClick={() => router.push("/create")} type="button">
            <FiPlus /> <span>Create</span>
          </button>
        )}
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
        {isAuthenticated && wallet.data && (
          <Link
            aria-label={`${wallet.data.shards} Shards, open wallet`}
            className="wallet-chip"
            href="/wallet"
          >
            <FiHexagon aria-hidden="true" /> {wallet.data.shards.toLocaleString()}
          </Link>
        )}
        {isAuthenticated && (
          <NotificationBell
            onClose={closeNotifications}
            onToggle={() => {
              setAccountOpen(false);
              setNotificationsOpen((current) => !current);
            }}
            open={notificationsOpen}
          />
        )}
        {isAuthenticated && (
          <div className="account-wrap">
            <button
              aria-expanded={accountOpen}
              aria-haspopup="menu"
              aria-label="Open account menu"
              className="mini-avatar"
              onClick={() => {
                setNotificationsOpen(false);
                setAccountOpen((current) => !current);
              }}
              ref={accountButtonRef}
              type="button"
            >
              <AvatarFace fallback={initials} image={user.image} />
            </button>
            <PresenceDot own status={myPresence?.status === "INVISIBLE" ? "INVISIBLE" : myPresence ? "ONLINE" : undefined} />
            {accountOpen && (
              <div className="user-menu" ref={accountMenuRef} role="menu">
                <div className="user-menu-profile">
                  <b>{user.name || "GachaHub user"}</b>
                  <small>{user.email}</small>
                </div>
                <StatusMenu
                  isPending={changePresence.isPending}
                  me={myPresence}
                  onChoose={(change: PresenceChange) => changePresence.mutate(change)}
                />
                <ModerationNavigation user={user} onNavigate={closeAccountMenu} />
                <Link href="/profile" onClick={() => setAccountOpen(false)} role="menuitem">
                  <FiUser /> View profile
                </Link>
                <Link href="/wallet" onClick={() => setAccountOpen(false)} role="menuitem">
                  <FiHexagon /> Wallet
                </Link>
                <Link href="/settings" onClick={() => setAccountOpen(false)} role="menuitem">
                  <FiSettings /> Settings
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
