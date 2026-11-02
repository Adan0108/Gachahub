export const POLICY_MAX_ATTEMPTS = 5;
export const POLICY_RETRY_BASE_MS = 2_000;
export const POLICY_RETRY_MAX_MS = 60_000;
export const POLICY_LEASE_MS = 30_000;
export const POLICY_POLL_MS = 2_000;
export const POLICY_WORK_BATCH_SIZE = 10;
export const POLICY_RECONCILE_MS = 60_000;
export const POLICY_RECONCILE_BATCH_SIZE = 100;

export function policyRetryDelay(attempt: number): number {
  return Math.min(
    POLICY_RETRY_MAX_MS,
    POLICY_RETRY_BASE_MS * 2 ** Math.max(0, attempt - 1),
  );
}
