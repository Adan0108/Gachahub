// Mirrors backend/src/users/dto/complete-onboarding.dto.ts's USERNAME_PATTERN - a cross-language
// copy is unavoidable, but keeping just one frontend copy here means the profile editor and any
// future search box share it instead of each writing a third.
export const USERNAME_PATTERN =
  /^(?=.{3,20}$)[A-Za-z0-9](?!.*[_-]{2,})[A-Za-z0-9_-]*[A-Za-z0-9]$/;
export const USERNAME_HINT =
  '3-20 characters: letters, digits, "_" and "-", starting and ending with a letter or digit, and never two separators in a row.';

// Forced redirect: only accounts created after onboarding shipped carry `onboarded: false`.
export const mustOnboard = (user) => user?.onboarded === false;
// Whether the claim endpoint will accept a request - also true for backfilled accounts.
export const canClaimHandle = (user) => Boolean(user) && !user.username;
