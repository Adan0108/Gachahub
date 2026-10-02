/**
 * Handles nobody gets to claim - once a username is shown next to a name
 * anywhere (profile, picker), one of these would be an impersonation vector.
 * Checked case-insensitively, same as citext uniqueness itself.
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
