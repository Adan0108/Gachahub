'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../lib/queries';
import { useSharedSocket } from '../lib/socket/sharedSocket';

/** Keeps the bell live: a notification saved for this user refreshes its badge and open list. */
export function useNotificationSocket() {
  const socket = useSharedSocket();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!socket) {
      return undefined;
    }

    const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.notifications });

    socket.on('notification:new', refresh);

    return () => {
      socket.off('notification:new', refresh);
    };
  }, [socket, queryClient]);
}
