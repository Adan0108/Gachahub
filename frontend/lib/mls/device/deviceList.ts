import type { DeviceId } from '../contract/types';

/** One of the user's own devices, as GET /chat-devices returns it. */
export interface ChatDeviceInfo {
  id: DeviceId;
  ciphersuite: string;
  createdAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
}

export interface DeviceRemovalOutcome {
  removed: DeviceId[];
  failed: { deviceId: DeviceId; error: Error }[];
}

/** Devices that can still be removed from here: live and not this one. */
export function removableDevices(
  devices: ChatDeviceInfo[],
  currentDeviceId: DeviceId | undefined,
): ChatDeviceInfo[] {
  return devices.filter((device) => !device.revokedAt && device.id !== currentDeviceId);
}

/** Live devices first, this one on top, then newest; removed ones last. */
export function sortDevices(
  devices: ChatDeviceInfo[],
  currentDeviceId: DeviceId | undefined,
): ChatDeviceInfo[] {
  const rank = (device: ChatDeviceInfo) =>
    device.revokedAt ? 2 : device.id === currentDeviceId ? 0 : 1;
  return [...devices].sort(
    (a, b) => rank(a) - rank(b) || Date.parse(b.createdAt) - Date.parse(a.createdAt),
  );
}

/**
 * Revokes each device on the server one by one (a 404 means it is already gone), then asks the
 * sync engine once to finish the MLS Remove commits for them. A failure on one never stops the rest.
 */
export async function removeDevices(
  deviceIds: DeviceId[],
  deps: {
    revoke: (deviceId: DeviceId) => Promise<unknown>;
    reconcile: () => Promise<unknown>;
  },
): Promise<DeviceRemovalOutcome> {
  const outcome: DeviceRemovalOutcome = { removed: [], failed: [] };

  for (const deviceId of deviceIds) {
    try {
      // eslint-disable-next-line no-await-in-loop -- one at a time keeps the server's work ordered
      await deps.revoke(deviceId);
      outcome.removed.push(deviceId);
    } catch (error) {
      if ((error as { status?: number }).status === 404) {
        outcome.removed.push(deviceId);
      } else {
        outcome.failed.push({
          deviceId,
          error: error instanceof Error ? error : new Error(String(error)),
        });
      }
    }
  }

  // The poll would do this anyway; failing here only delays the Remove.
  if (outcome.removed.length > 0) await deps.reconcile().catch(() => undefined);
  return outcome;
}
