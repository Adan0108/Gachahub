'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { io } from 'socket.io-client';
import { useCurrentUser } from './useCurrentUser';
import { API_BASE_URL } from '../lib/api';
import { queryKeys } from '../lib/queries';
import { MAX_RECONNECT_ATTEMPTS, reconnectDelayMs } from '../lib/chat/socketReconnect';
import { setSharedSocket } from '../lib/socket/sharedSocket';

/**
 * Owns the app's single live connection (mounted once, in AppShell) and publishes it for
 * useChatSocket, useNotificationSocket and any future feature to attach their own listeners to.
 * Connection concerns only: sign-out on a revoked login, and reconnecting after a server drop.
 */
export function useAppSocket() {
  const { user, isAuthenticated } = useCurrentUser();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!isAuthenticated || !user?.id) {
      return undefined;
    }

    const socket = io(API_BASE_URL, { withCredentials: true });
    let reconnectAttempts = 0;
    let reconnectTimer;

    // This login was ended from another device: leave at once, with a full reload so nothing stays in memory.
    const signOutHere = () => {
      queryClient.setQueryData(queryKeys.currentUser, null);
      window.location.assign('/login');
    };
    // Only this explicit event signs the browser out - a reconnect with a dead login receives it
    // again from the gateway, and a plain drop or backend hiccup must never log anyone out.
    socket.on('session:revoked', signOutHere);

    // A real, live connection resets the budget - only a run of CONSECUTIVE failures should ever
    // exhaust it, not the cumulative count over a tab's whole lifetime.
    socket.on('connect', () => {
      reconnectAttempts = 0;
    });

    // socket.io does NOT auto-reconnect after a server-initiated disconnect (the gateway calls
    // socket.disconnect() on both a backend hiccup and a dead login) - without this, that tab stays
    // cut off from new messages and future sign-out events until the page is reloaded by hand. A dead
    // login just gets session:revoked again on the reconnect the gateway sees.
    socket.on('disconnect', (reason) => {
      if (reason !== 'io server disconnect') return;
      if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) return;

      const delay = reconnectDelayMs(reconnectAttempts);
      reconnectAttempts += 1;
      reconnectTimer = setTimeout(() => socket.connect(), delay);
    });

    setSharedSocket(socket);

    return () => {
      clearTimeout(reconnectTimer);
      setSharedSocket(null);
      socket.disconnect();
    };
  }, [isAuthenticated, user?.id, queryClient]);
}
