import type { DeviceId, UserId } from '../contract/types';

export function encodeIdentity(userId: UserId, deviceId: DeviceId): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({ userId, deviceId }));
}

/**
 * Parses a ratchet-tree leaf's credential identity - bytes that arrived
 * over the wire (via a Welcome or Commit from the server, which never
 * inspects Welcome contents) rather than something this device produced
 * itself. Returns undefined instead of throwing for anything malformed, so
 * one bad credential can be rejected as data (a normal ProcessResult) by
 * the caller instead of crashing out of process() with a raw SyntaxError -
 * which would otherwise repeat identically on every retry, permanently
 * wedging that conversation's sync.
 */
export function decodeIdentity(
  identity: Uint8Array,
): { userId: UserId; deviceId: DeviceId } | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(identity));
  } catch {
    return undefined;
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as { userId?: unknown }).userId !== 'string' ||
    typeof (parsed as { deviceId?: unknown }).deviceId !== 'string'
  ) {
    return undefined;
  }
  return parsed as { userId: UserId; deviceId: DeviceId };
}
