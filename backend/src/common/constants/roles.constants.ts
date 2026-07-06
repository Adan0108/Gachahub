/**
 * System-level roles used by Gacha Hub.
 *
 * USER:
 * - Normal authenticated user.
 * - Can create posts, comments, reactions, saves, follows later.
 *
 * ADMIN:
 * - Full platform-level permission.
 * - Can manage games, game categories, and assign moderators.
 *
 * Game moderator is not here because moderator permission is scoped
 * to a specific game and is stored in the GameModerator table.
 */
export const USER_ROLES = {
  USER: 'USER',
  ADMIN: 'ADMIN',
} as const;

/**
 * TypeScript union type generated from USER_ROLES.
 *
 * Example:
 * const role: UserRole = USER_ROLES.ADMIN;
 */
export type UserRole = (typeof USER_ROLES)[keyof typeof USER_ROLES];
