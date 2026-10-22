/**
 * An exception that adds fields of its own to the error response, beyond message and code.
 * HttpExceptionFilter copies exactly what responseExtras() returns, on errors below 500 only,
 * so each exception decides what is safe to show and the filter never changes for a new one.
 */
export interface WithResponseExtras {
  responseExtras(): Record<string, unknown>;
}

export function hasResponseExtras(
  exception: unknown,
): exception is WithResponseExtras {
  return (
    typeof (exception as Partial<WithResponseExtras> | null)?.responseExtras ===
    'function'
  );
}
