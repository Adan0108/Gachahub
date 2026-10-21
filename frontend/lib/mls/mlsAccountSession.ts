import { bindMlsAccount } from './storage/mlsEncryptedStore';

/**
 * Ties this page's local encrypted data to the signed-in account, as soon as the account is known.
 * Each account keeps its own data, so another account signing in never destroys the first one's
 * keys; but this page's in-memory state belongs to whoever it started with, so a different account
 * gets a clean page instead.
 */
export function bindSignedInAccount(
  userId: string | null | undefined,
  reload: () => void = () => window.location.reload(),
): void {
  if (!userId) return;
  if (bindMlsAccount(userId) === 'switched') reload();
}
