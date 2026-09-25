// Not worth retrying: the server understood the request and refused it (a timeout or rate limit passes).
const RETRYABLE_CLIENT_STATUSES = new Set([408, 425, 429]);

/** True when a failed submit carries a definitive 4xx answer, so the same bytes will never be accepted. */
export function isDefinitiveRejection(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  return (
    typeof status === 'number' &&
    status >= 400 &&
    status < 500 &&
    !RETRYABLE_CLIENT_STATUSES.has(status)
  );
}
