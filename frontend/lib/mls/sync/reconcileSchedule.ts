// Poll is 5s (useSyncEngine); the backend's work lease (60s) and cooldown (2min) are sized against it.
export const FULL_RECONCILE_INTERVAL_MS = 5 * 60_000;

export type ReconcileScope = 'pending' | 'full';

/** Picks how much of the work list this poll should walk, or null to skip it. */
export function nextReconcileScope(
  now: number,
  lastFullAt: number | null,
  tabHidden: boolean,
): ReconcileScope | null {
  if (tabHidden) return null;
  if (lastFullAt === null || now - lastFullAt >= FULL_RECONCILE_INTERVAL_MS) return 'full';
  return 'pending';
}
