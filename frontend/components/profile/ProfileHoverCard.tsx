"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useCurrentUser } from "../../hooks/useCurrentUser";
import { queries, type UserHoverCardData } from "../../lib/queries";
import { bannerSurface, cosmeticSurface, resolveBanner } from "../../lib/cosmetics";
import { rankName } from "../../lib/economy";
import { compactCount } from "../../lib/profile/profileView";
import { Art } from "../Art";
import { AvatarFace } from "../AvatarFace";
import { FollowButton } from "./FollowButton";

const HOVER_OPEN_DELAY_MS = 400;
const HOVER_CLOSE_DELAY_MS = 180;

export function ProfileHoverCardView({
  userId,
  card,
  isLoading,
  isError,
  viewerId,
  showTouchViewProfileButton = false,
}: {
  userId: string;
  card?: UserHoverCardData | null;
  isLoading?: boolean;
  isError?: boolean;
  viewerId?: string | null;
  showTouchViewProfileButton?: boolean;
}) {
  if (isLoading) {
    return (
      <div className="profile-hover-unavailable" role="status">
        Loading profile...
      </div>
    );
  }

  if (isError || !card) {
    return (
      <div className="profile-hover-unavailable" role="status">
        This account isn&apos;t available
      </div>
    );
  }

  const isSelf = Boolean(viewerId && viewerId === card.id);
  const miniBg = card.equipped?.miniBackground ?? null;
  const { className: miniBgPresetClass, style: miniBgStyle } = cosmeticSurface(miniBg);

  const resolvedBanner = resolveBanner({
    premium: card.premium,
    equippedBanner: card.equipped?.banner ?? null,
    bannerPresetId: card.bannerPresetId ?? null,
  });

  const { className: bannerPresetClass, style: bannerStyle } = bannerSurface(resolvedBanner);

  const profileHref = `/user/${encodeURIComponent(card.id || userId)}`;

  return (
    <div
      className={`${miniBg ? "has-mini-bg" : ""} ${miniBgPresetClass}`.trim()}
      style={{ position: "relative", ...miniBgStyle }}
    >
      {miniBg && <div className="profile-hover-mini-scrim" aria-hidden="true" />}
      <div
        className={`profile-hover-banner ${bannerPresetClass}`.trim()}
        style={bannerStyle}
      />
      <div className="profile-hover-body">
        <div className="profile-hover-top-row">
          <Link className="profile-hover-avatar-link" href={profileHref}>
            <div style={{ width: 52, height: 52 }}>
              <AvatarFace
                fallback={<Art tone="blue">{(card.name || "U").charAt(0).toUpperCase()}</Art>}
                frame={card.equipped?.frame ?? null}
                image={card.image}
                name={card.name}
              />
            </div>
          </Link>

          <div className="profile-hover-actions">
            {isSelf ? (
              <Link className="profile-hover-view-btn" href={profileHref}>
                Edit Profile
              </Link>
            ) : card.isBlockedByMe ? null : !viewerId ? (
              <Link className="follow-button compact" href="/login">
                <span className="follow-label">Follow</span>
              </Link>
            ) : (
              <FollowButton
                compact
                followsYou={card.followsYou}
                isFollowing={card.isFollowing}
                userId={card.id}
              />
            )}
          </div>
        </div>

        <div className="profile-hover-identity">
          <div className="profile-hover-name-row">
            <Link className="profile-hover-name" href={profileHref}>
              {card.name || "GachaHub user"}
            </Link>
            {card.premium && (
              <span className="profile-hover-supporter-badge" title="Supporter">
                ★ Supporter
              </span>
            )}
          </div>
          <div className="profile-hover-handle-row">
            {card.username && <span>@{card.username}</span>}
            {card.followsYou && !isSelf && <span className="follows-you">Follows you</span>}
          </div>
        </div>

        {card.isBlockedByMe ? (
          <div className="profile-hover-blocked-note">You blocked this person</div>
        ) : (
          <div className="profile-hover-stats">
            <span className="profile-hover-rank-pill">{rankName(card.rank)}</span>
            <span>
              <b>{(card.reputation ?? 0).toLocaleString()}</b> Reputation
            </span>
            {card.followersCount != null && (
              <span>
                <b>{compactCount(card.followersCount)}</b> Followers
              </span>
            )}
          </div>
        )}

        {showTouchViewProfileButton && (
          <div className="profile-hover-actions">
            <Link className="profile-hover-view-btn" href={profileHref}>
              View profile
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

function ConnectedProfileHoverCardBody({
  userId,
  showTouchViewProfileButton,
}: {
  userId: string;
  showTouchViewProfileButton: boolean;
}) {
  const { user: viewer } = useCurrentUser();
  const cardQuery = useQuery(queries.userCard(userId));
  return (
    <ProfileHoverCardView
      card={cardQuery.data}
      isError={cardQuery.isError}
      isLoading={cardQuery.isLoading}
      showTouchViewProfileButton={showTouchViewProfileButton}
      userId={userId}
      viewerId={viewer?.id ?? null}
    />
  );
}

/**
 * Wraps a user's avatar or display name.
 * - Hovering for 400 ms opens the mini profile popover; moving into the card keeps it open.
 * - Keyboard focus opens the popover; Escape closes it.
 * - On touch devices, tapping opens the card with a "View profile" button inside.
 */
export function ProfileHoverTrigger({
  userId,
  children,
  className,
}: {
  userId?: string | null;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [openedByTouch, setOpenedByTouch] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchRecentRef = useRef(false);

  const clearTimers = useCallback(() => {
    if (openTimerRef.current) {
      clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const updatePosition = useCallback(() => {
    const el = triggerRef.current;
    if (!el || typeof window === "undefined") return;
    const rect = el.getBoundingClientRect();
    const cardWidth = 310;
    const cardHeight = 230;
    const margin = 10;

    let left = rect.left;
    if (left + cardWidth + margin > window.innerWidth) {
      left = Math.max(margin, window.innerWidth - cardWidth - margin);
    }

    let top = rect.bottom + 8;
    if (top + cardHeight + margin > window.innerHeight && rect.top - cardHeight - 8 > margin) {
      top = rect.top - cardHeight - 8;
    }

    setCoords({ top, left });
  }, []);

  const scheduleOpen = useCallback(() => {
    if (!userId) return;
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    if (open) return;
    if (openTimerRef.current) clearTimeout(openTimerRef.current);
    openTimerRef.current = setTimeout(() => {
      updatePosition();
      setOpen(true);
    }, HOVER_OPEN_DELAY_MS);
  }, [open, updatePosition, userId]);

  const scheduleClose = useCallback(() => {
    if (openTimerRef.current) {
      clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = setTimeout(() => {
      setOpen(false);
      setOpenedByTouch(false);
    }, HOVER_CLOSE_DELAY_MS);
  }, []);

  useEffect(() => {
    return () => clearTimers();
  }, [clearTimers]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        clearTimers();
        setOpen(false);
        setOpenedByTouch(false);
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (triggerRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      clearTimers();
      setOpen(false);
      setOpenedByTouch(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [clearTimers, open]);

  if (!userId) {
    return <>{children}</>;
  }

  const handleTouchStart = () => {
    touchRecentRef.current = true;
  };

  const handleClickCapture = (event: ReactMouseEvent<HTMLSpanElement>) => {
    if (!touchRecentRef.current) return;
    touchRecentRef.current = false;
    if (!open) {
      event.preventDefault();
      event.stopPropagation();
      clearTimers();
      updatePosition();
      setOpenedByTouch(true);
      setOpen(true);
    }
  };

  // Focus moving between the name and its card keeps the card open; leaving both closes it.
  const isInside = (node: EventTarget | null) =>
    node instanceof Node &&
    Boolean(triggerRef.current?.contains(node) || popoverRef.current?.contains(node));
  const handleBlur = (event: ReactFocusEvent<HTMLElement>) => {
    if (!isInside(event.relatedTarget)) scheduleClose();
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLSpanElement>) => {
    // The card is portaled to the end of the page, so Tab would skip it; send focus into it instead.
    if (event.key === "Tab" && !event.shiftKey && open) {
      const first = popoverRef.current?.querySelector<HTMLElement>("a[href], button:not([disabled])");
      if (first) {
        event.preventDefault();
        first.focus();
      }
      return;
    }
    if (event.key === "Escape" && open) {
      event.stopPropagation();
      clearTimers();
      setOpen(false);
      setOpenedByTouch(false);
    }
  };

  return (
    <>
      <span
        className={`profile-hover-trigger ${className ?? ""}`.trim()}
        onBlur={handleBlur}
        onClickCapture={handleClickCapture}
        onFocus={() => {
          clearTimers();
          updatePosition();
          setOpen(true);
        }}
        onKeyDown={handleKeyDown}
        onMouseEnter={scheduleOpen}
        onMouseLeave={scheduleClose}
        onTouchStart={handleTouchStart}
        ref={triggerRef}
      >
        {children}
      </span>
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            aria-label="Mini profile card"
            className="profile-hover-popover"
            onMouseEnter={() => {
              if (closeTimerRef.current) {
                clearTimeout(closeTimerRef.current);
                closeTimerRef.current = null;
              }
            }}
            onBlur={handleBlur}
            onMouseLeave={scheduleClose}
            ref={popoverRef}
            role="dialog"
            style={{ top: coords.top, left: coords.left }}
          >
            <ConnectedProfileHoverCardBody
              showTouchViewProfileButton={openedByTouch}
              userId={userId}
            />
          </div>,
          document.body,
        )}
    </>
  );
}
