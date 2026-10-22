"use client";

import { useState } from "react";
import { FiCheck, FiChevronRight } from "react-icons/fi";
import { OFFLINE_DURATIONS, describeUntil } from "../lib/presence/offlineDurations";

/** The Status row of the account menu: Online, or Offline for a chosen time, like Discord's Invisible. */
export type PresenceChange = { status: string; duration?: string };

export function StatusMenu({
  me,
  isPending,
  onChoose,
}: {
  me?: { status?: string; until?: string | null } | null;
  isPending?: boolean;
  onChoose: (change: PresenceChange) => void;
}) {
  const [open, setOpen] = useState(false);
  const [offlineOpen, setOfflineOpen] = useState(false);
  const isOffline = me?.status === "INVISIBLE";

  const choose = (change: PresenceChange) => {
    onChoose(change);
    setOpen(false);
    setOfflineOpen(false);
  };

  return (
    <div
      className="status-menu"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => {
        setOpen(false);
        setOfflineOpen(false);
      }}
    >
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        className="status-row"
        onClick={() => setOpen(true)}
        role="menuitem"
        type="button"
      >
        <span aria-hidden="true" className={`presence-dot inline ${isOffline ? "hidden" : "online"}`} />
        <span className="status-row-text">
          <span className="status-label">{isOffline ? "Offline" : "Online"}</span>
          {isOffline && <small>{describeUntil(me.until) || "until you change it"}</small>}
        </span>
        <FiChevronRight aria-hidden="true" />
      </button>
      {open && (
        <div className="status-flyout" role="menu">
          <button
            className="status-option"
            disabled={isPending}
            onClick={() => choose({ status: "ONLINE" })}
            role="menuitemradio"
            aria-checked={!isOffline}
            type="button"
          >
            <span aria-hidden="true" className="presence-dot inline online" />
            <span className="status-row-text">
              <span className="status-label">Online</span>
            </span>
            {!isOffline && <FiCheck aria-hidden="true" />}
          </button>
          <div className="status-option-wrap">
            <button
              aria-expanded={offlineOpen}
              aria-haspopup="menu"
              className="status-option"
              onClick={() => setOfflineOpen(true)}
              onMouseEnter={() => setOfflineOpen(true)}
              role="menuitem"
              type="button"
            >
              <span aria-hidden="true" className="presence-dot inline hidden" />
              <span className="status-row-text">
                <span className="status-label">Offline</span>
                <small>You will appear offline</small>
              </span>
              <FiChevronRight aria-hidden="true" />
            </button>
            {offlineOpen && (
              <div className="status-flyout durations" role="menu">
                {OFFLINE_DURATIONS.map(({ value, label }) => (
                  <button
                    className="status-option"
                    disabled={isPending}
                    key={value}
                    onClick={() => choose({ status: "INVISIBLE", duration: value })}
                    role="menuitem"
                    type="button"
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
