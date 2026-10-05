/**
 * Exact-match denylist of obvious official-sounding handles, checked case-insensitively at
 * claim time only. Raises the bar; it does not stop lookalikes like `admin1` or `support-team`.
 */
const RESERVED_USERNAMES = new Set([
  'admin',
  'administrator',
  'support',
  'staff',
  'moderator',
  'mod',
  'help',
  'system',
  'gachahub',
  'official',
  'root',
  'security',
]);

export function isReservedUsername(username: string): boolean {
  return RESERVED_USERNAMES.has(username.toLowerCase());
}
