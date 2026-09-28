'use client';

import { useEffect, useRef, useState } from 'react';
import { useSyncEngine } from './useSyncEngine';
import { useDeviceIdentity } from './useDeviceIdentity';
import {
  GroupStateCorruptedError,
  GroupStateUnavailableError,
  MembershipMismatchError,
} from '../lib/mls/contract/errors';
import { wasSentByDevice } from '../lib/mls/messaging/messageOrigin';
import { base64ToBytes } from '../lib/mls/storage/base64';
import {
  nextRetryDelayMs,
  recoveryRetryDelayMs,
  shouldRetryDecrypt,
} from '../lib/mls/messaging/decryptRetry';
import { EncryptedIndexedDbMessagePlaintextStore } from '../lib/mls/storage/messagePlaintextStore';
import type { SyncEngine } from '../lib/mls/sync/syncEngine';
import type { ConversationId, PlaintextEnvelope } from '../lib/mls/contract/types';

const plaintextStore = new EncryptedIndexedDbMessagePlaintextStore();

/** syncCommits with one recovery attempt when there is no local group state yet. */
async function syncCommitsRecoveringMissingWelcome(
  syncEngine: SyncEngine,
  conversationId: ConversationId,
): Promise<void> {
  try {
    await syncEngine.syncCommits(conversationId);
  } catch (error) {
    if (error instanceof GroupStateCorruptedError || error instanceof MembershipMismatchError) {
      if (!(await syncEngine.recoverBrokenGroup(conversationId))) throw error;
      await syncEngine.syncCommits(conversationId);
      return;
    }
    if (!(error instanceof GroupStateUnavailableError)) throw error;
    await syncEngine.processPendingWelcomes();
    try {
      await syncEngine.syncCommits(conversationId);
    } catch (retryError) {
      // Still no group: one bounded self-join try, otherwise the group is flagged as a problem.
      if (!(retryError instanceof GroupStateUnavailableError)) throw retryError;
      if (!(await syncEngine.recoverMissingGroup(conversationId))) throw retryError;
      await syncEngine.syncCommits(conversationId);
    }
  }
}

export type DecryptedMessageState =
  | { status: 'pending' }
  | { status: 'ok'; envelope: PlaintextEnvelope }
  /** Genuinely gone on this device - wrong key generation, missing history, or a decode failure. Not retried. A message that only failed because the commit sync did, stays pending and is retried. */
  | { status: 'unavailable' };

interface ChatMessageRow {
  id: string;
  conversationId?: string;
  senderId: string;
  ciphertext: string;
  encryptionMeta?: unknown;
}

/** Decrypts each message once and caches the plaintext locally; own sent messages come from the send-time cache. */
export function useDecryptedMessages(
  conversationId: ConversationId,
  messages: ChatMessageRow[],
  currentUserId: string | undefined,
): Record<string, DecryptedMessageState> {
  const syncEngine = useSyncEngine();
  const ownDeviceId = useDeviceIdentity().credential?.deviceId;
  const [decrypted, setDecrypted] = useState<Record<string, DecryptedMessageState>>({});
  // Message ids already claimed by a running effect; message keys are single-use.
  const inFlightRef = useRef<Set<string>>(new Set());
  // Bumped by a timer to run the effect again for messages that couldn't be decrypted
  // only because catching up on commits failed.
  const [retryTick, setRetryTick] = useState(0);
  const retryAttemptsRef = useRef(0);
  // Retries spent waiting for a group recovery cooldown to end; separate from the backoff budget.
  const recoveryRetriesRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Bumped when the conversation changes, so a run from the old one cannot touch the new one's counters or timer.
  const conversationTokenRef = useRef(0);

  useEffect(() => () => clearTimeout(retryTimerRef.current), []);

  // A new conversation starts with clean attempts, no timer and no old entries.
  useEffect(() => {
    conversationTokenRef.current += 1;
    retryAttemptsRef.current = 0;
    recoveryRetriesRef.current = 0;
    clearTimeout(retryTimerRef.current);
    setDecrypted({});
  }, [conversationId]);

  // Regaining connectivity resets the retry budget and forces an immediate rescan.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handleOnline = () => {
      retryAttemptsRef.current = 0;
      recoveryRetriesRef.current = 0;
      clearTimeout(retryTimerRef.current);
      setRetryTick((tick) => tick + 1);
    };
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, []);

  useEffect(() => {
    if (!syncEngine || !conversationId || messages.length === 0) {
      return;
    }
    let cancelled = false;
    const conversationToken = conversationTokenRef.current;
    // Messages this run has claimed, so a failure anywhere below can settle them instead of leaving a blank gap.
    let claimed: ChatMessageRow[] = [];

    void (async () => {
      // Cache hits resolve first so they show without waiting on syncCommits.
      const pendingIncoming: ChatMessageRow[] = [];
      await Promise.all(
        messages.map(async (message) => {
          const cached = await plaintextStore.get(message.id);
          if (cached) {
            setDecrypted((prev) => ({
              ...prev,
              [message.id]: { status: 'ok', envelope: cached.envelope },
            }));
            return;
          }

          // senderId is server-authenticated; the meta is the sender's own word, so a lie here can only mislabel your own account's messages.
          if (
            message.senderId === currentUserId &&
            ownDeviceId !== undefined &&
            wasSentByDevice(message.encryptionMeta, ownDeviceId)
          ) {
            // Sent from this device with no local copy: its key is gone, so it cannot be decrypted.
            setDecrypted((prev) => ({ ...prev, [message.id]: { status: 'unavailable' } }));
            return;
          }

          if (inFlightRef.current.has(message.id)) {
            // Already claimed by another running invocation; decrypting again would burn its one-time key.
            return;
          }

          pendingIncoming.push(message);
        }),
      );

      if (pendingIncoming.length === 0 || cancelled) {
        return;
      }

      claimed = pendingIncoming;
      for (const message of pendingIncoming) {
        inFlightRef.current.add(message.id);
      }

      const wireBytesByMessageId = new Map(
        pendingIncoming.map((message) => [message.id, base64ToBytes(message.ciphertext)]),
      );

      // Skip syncCommits when every pending message is already at the current epoch.
      const atCurrentEpoch = await Promise.all(
        pendingIncoming.map((message) =>
          syncEngine.isAtCurrentEpoch(conversationId, wireBytesByMessageId.get(message.id)!),
        ),
      );
      const needsSync = atCurrentEpoch.some((isCurrent) => !isCurrent);

      let syncError: unknown;
      if (needsSync) {
        try {
          await syncCommitsRecoveringMissingWelcome(syncEngine, conversationId);
        } catch (error) {
          syncError = error;
          console.warn('Could not sync MLS commits before decrypting messages', error);
        }
      }
      // A group that could not be recovered yet is tried once more when its cooldown ends.
      const recoveryDelayMs = recoveryRetryDelayMs(
        syncError,
        syncEngine.recoveryWaitMs(conversationId),
        recoveryRetriesRef.current,
      );
      const retryable =
        shouldRetryDecrypt(syncError, retryAttemptsRef.current) || recoveryDelayMs !== undefined;

      // Always settle: the message is claimed and its key consumed, so this is its only outcome.
      let needsRetry = false;
      await Promise.all(
        pendingIncoming.map(async (message) => {
          try {
            const result = await syncEngine.processIncoming(
              conversationId,
              wireBytesByMessageId.get(message.id)!,
            );
            if (result.kind !== 'application') {
              setDecrypted((prev) => ({ ...prev, [message.id]: { status: 'unavailable' } }));
              return;
            }
            await plaintextStore.save({
              messageId: message.id,
              conversationId,
              senderDeviceId: result.senderDeviceId,
              epoch: result.epoch,
              envelope: result.envelope,
            });
            setDecrypted((prev) => ({
              ...prev,
              [message.id]: { status: 'ok', envelope: result.envelope },
            }));
          } catch (error) {
            console.warn(`Could not decrypt message ${message.id}`, error);
            // Without the commit sync the message may just need a commit this device hasn't got yet.
            const status = retryable ? 'pending' : 'unavailable';
            needsRetry ||= retryable;
            setDecrypted((prev) => ({ ...prev, [message.id]: { status } }));
          } finally {
            inFlightRef.current.delete(message.id);
          }
        }),
      );

      // A run for a conversation that has since changed leaves the new one's counters and timer alone.
      if (conversationToken !== conversationTokenRef.current) return;
      if (!needsRetry) {
        retryAttemptsRef.current = 0;
        recoveryRetriesRef.current = 0;
      } else {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = setTimeout(
          () => setRetryTick((tick) => tick + 1),
          recoveryDelayMs ?? nextRetryDelayMs(retryAttemptsRef.current),
        );
        if (recoveryDelayMs !== undefined) recoveryRetriesRef.current += 1;
        else retryAttemptsRef.current += 1;
      }
    })().catch((error: unknown) => {
      // e.g. local storage failing: settle as unavailable rather than leaving the messages absent forever.
      console.warn('Could not decrypt messages', error);
      const stuck = claimed.length > 0 ? claimed : messages;
      for (const message of claimed) inFlightRef.current.delete(message.id);
      setDecrypted((prev) => {
        const next = { ...prev };
        for (const message of stuck) {
          if (!next[message.id] || next[message.id]!.status === 'pending') {
            next[message.id] = { status: 'unavailable' };
          }
        }
        return next;
      });
    });

    return () => {
      cancelled = true;
    };
    // Keyed off the id list, since messages is a fresh array on every fetch.
  }, [
    syncEngine,
    conversationId,
    messages.map((message) => message.id).join(','),
    currentUserId,
    ownDeviceId,
    retryTick,
  ]);

  return decrypted;
}
