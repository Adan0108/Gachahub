export const MY_PRESENCE_STATUSES = ['ONLINE', 'INVISIBLE'] as const;
export type MyPresenceStatus = (typeof MY_PRESENCE_STATUSES)[number];

/** What other people see: whoever is invisible reads as offline. */
export type PublicPresence = 'ONLINE' | 'OFFLINE';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/** How long someone stays invisible; forever has no end time. */
export const INVISIBLE_DURATIONS_MS = {
  '15m': 15 * MINUTE_MS,
  '1h': HOUR_MS,
  '8h': 8 * HOUR_MS,
  '24h': 24 * HOUR_MS,
  '3d': 72 * HOUR_MS,
  forever: null,
} as const;
export type InvisibleDuration = keyof typeof INVISIBLE_DURATIONS_MS;
export const INVISIBLE_DURATIONS = Object.keys(
  INVISIBLE_DURATIONS_MS,
) as InvisibleDuration[];

/** A socket that has not pinged for this long no longer counts as connected. */
export const SOCKET_STALE_AFTER_MS = 70_000;
export const MAX_PRESENCE_LOOKUP = 100;
export const PRESENCE_AUDIENCE_LIMIT = 500;
export const EXPIRY_SWEEP_MS = 10_000;

/** After the last tab closes, people keep seeing them online for a random while, so a closed tab does not show at once. */
export const OFFLINE_GRACE_MIN_MS = 60_000;
export const OFFLINE_GRACE_MAX_MS = 180_000;

export const socketsKey = (userId: string) => `presence:sockets:${userId}`;
export const preferenceKey = (userId: string) => `presence:pref:${userId}`;
export const EXPIRIES_KEY = 'presence:expiries';
export const LINGER_KEY = 'presence:linger';
