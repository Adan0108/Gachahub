'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSyncEngine } from './useSyncEngine';
import { computePeerSafety, verifyPeer, type PeerSafety } from '../lib/mls/verification/peerSafety';
import { EncryptedIndexedDbVerifiedPeerStore } from '../lib/mls/verification/verifiedPeerStore';
import type { ConversationId, UserId } from '../lib/mls/contract/types';

const store = new EncryptedIndexedDbVerifiedPeerStore();
// Membership changes arrive with commits; a slow re-check catches a peer's device changes.
const REFRESH_INTERVAL_MS = 10_000;
const NO_NUMBERS: Record<UserId, PeerSafety> = {};

export interface SafetyNumbers {
  byUser: Record<UserId, PeerSafety>;
  /** True when the group's members could not be read (not the same as "not joined yet"). */
  hasError: boolean;
  verify: (peerId: UserId) => Promise<void>;
  retry: () => Promise<void>;
}

interface Loaded {
  conversationId: ConversationId;
  byUser: Record<UserId, PeerSafety>;
  hasError: boolean;
}

/** Safety numbers and verified state for peers of a conversation, derived only from local MLS group state. */
export function useSafetyNumbers(
  conversationId: ConversationId,
  ownUserId: UserId | undefined,
  peerIds: UserId[],
): SafetyNumbers {
  const syncEngine = useSyncEngine();
  const peerKey = peerIds.join(',');
  const peers = useMemo(() => (peerKey ? peerKey.split(',') : []), [peerKey]);
  const [loaded, setLoaded] = useState<Loaded>();
  const currentConversation = useRef(conversationId);
  // Refreshes and verifies run one at a time so an old read never lands over a fresh save.
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    currentConversation.current = conversationId;
  }, [conversationId]);

  const enqueue = useCallback((task: () => Promise<void>) => {
    const run = queue.current.then(task);
    queue.current = run.catch(() => undefined);
    return run;
  }, []);

  const refresh = useCallback(
    () =>
      enqueue(async () => {
        if (!syncEngine || !ownUserId || !conversationId || peers.length === 0) return;
        const commit = (update: Partial<Loaded>) => {
          if (currentConversation.current !== conversationId) return;
          setLoaded((previous) => ({
            conversationId,
            byUser: previous?.conversationId === conversationId ? previous.byUser : NO_NUMBERS,
            hasError: false,
            ...update,
          }));
        };
        try {
          const leaves = await syncEngine.listLeaves(conversationId);
          commit({ byUser: await computePeerSafety(store, ownUserId, peers, leaves) });
        } catch (error) {
          console.warn('Could not compute safety numbers', error);
          commit({ hasError: true });
        }
      }),
    [enqueue, syncEngine, ownUserId, conversationId, peers],
  );

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const current = loaded?.conversationId === conversationId ? loaded : undefined;
  const byUser = current?.byUser ?? NO_NUMBERS;

  const verify = useCallback(
    async (peerId: UserId) => {
      const devices = byUser[peerId]?.devices;
      if (!ownUserId || !devices?.length) return;
      await enqueue(() => verifyPeer(store, { ownUserId, peerUserId: peerId }, devices));
      await refresh();
    },
    [byUser, ownUserId, enqueue, refresh],
  );

  return { byUser, hasError: current?.hasError ?? false, verify, retry: refresh };
}
