'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { removeDevices, type ChatDeviceInfo } from '../lib/mls/device/deviceList';
import type { SyncEngine } from '../lib/mls/sync/syncEngine';
import type { DeviceId } from '../lib/mls/contract/types';

const DEVICES_KEY = ['chat', 'devices'];

/** The user's own devices, and removal of other ones (server revoke, then the MLS Remove via the sync engine). */
export function useChatDevices(enabled: boolean, syncEngine: SyncEngine | undefined) {
  const queryClient = useQueryClient();
  const devices = useQuery({
    queryKey: DEVICES_KEY,
    queryFn: async () => ((await api.getChatDevices()) as { items: ChatDeviceInfo[] }).items ?? [],
    enabled,
    retry: 1,
    staleTime: 10_000,
  });

  const remove = useMutation({
    mutationFn: async (deviceIds: DeviceId[]) => {
      const outcome = await removeDevices(deviceIds, {
        revoke: (deviceId) => api.revokeChatDevice(deviceId),
        reconcile: () => syncEngine?.reconcileMembership() ?? Promise.resolve(),
      });
      if (outcome.failed.length > 0) {
        throw new Error(
          `Couldn't remove ${outcome.failed.length} of ${deviceIds.length} devices. Try again.`,
        );
      }
      return outcome;
    },
    // Partial success still changed the list.
    onSettled: () => queryClient.invalidateQueries({ queryKey: DEVICES_KEY }),
  });

  return { devices, remove };
}
