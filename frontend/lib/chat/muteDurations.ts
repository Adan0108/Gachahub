const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/** What the mute menu offers; `ms: null` mutes until you turn it back on. */
export type MuteOption = { id: string; label: string; ms: number | null };
export type MuteChange = { notificationLevel: "NOTHING"; mutedUntil?: string };

export const MUTE_OPTIONS: MuteOption[] = [
  { id: "15m", label: "15 minutes", ms: 15 * MINUTE_MS },
  { id: "1h", label: "1 hour", ms: HOUR_MS },
  { id: "8h", label: "8 hours", ms: 8 * HOUR_MS },
  { id: "24h", label: "24 hours", ms: 24 * HOUR_MS },
  { id: "forever", label: "Until I turn it back on", ms: null },
];

export const UNMUTE = { notificationLevel: "ALL" as const };

/** The change to send for a menu option; an open-ended mute sends no end time. */
export function muteChange(option: MuteOption, now = Date.now()): MuteChange {
  return {
    notificationLevel: "NOTHING",
    mutedUntil: option.ms === null ? undefined : new Date(now + option.ms).toISOString(),
  };
}

/** "Muted until 3:40 PM", with the date when it isn't today; no end time reads as until you turn it back on. */
export function describeMutedUntil(mutedUntil?: string | null, now = new Date()): string {
  if (!mutedUntil) return "Muted until you turn it back on";

  const until = new Date(mutedUntil);
  const time = until.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (until.toDateString() === now.toDateString()) return `Muted until ${time}`;

  const day = until.toLocaleDateString([], { month: "short", day: "numeric" });
  return `Muted until ${day}, ${time}`;
}
