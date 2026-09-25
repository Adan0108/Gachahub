'use client';

import { useEffect, useRef, useState } from 'react';
import { useSyncEngine } from './useSyncEngine';
import { useDeviceIdentity } from './useDeviceIdentity';
import { GroupStateUnavailableError } from '../lib/mls/contract/errors';
import { wasSentByDevice } from '../lib/mls/messaging/messageOrigin';
import { base64ToBytes } from '../lib/mls/storage/base64';
import { nextRetryDelayMs, shouldRetryDecrypt } from '../lib/mls/messaging/decryptRetry';
import { EncryptedIndexedDbMessagePlaintextStore } from '../lib/mls/storage/messagePlaintextStore';
import type { SyncEngine } from '../lib/mls/sync/syncEngine';
import type { ConversationId, PlaintextEnvelope } from '../lib/mls/contract/types';

const plaintextStore = new EncryptedIndexedDbMessagePlaintextStore();

/**
 * syncCommits, with one recovery attempt for the one case that isn't necessarily permanent: no
 * local group state at all yet. The very first message into a brand-new conversation can arrive
 * (over the socket) before this device's own Welcome-polling loop has processed the Welcome that
 * was created moments earlier by the same send. Deliberately NOT extended to
 * MembershipMismatchError: that can mean a genuinely refused commit (a group problem, not a
 * missing-Welcome problem, see decryptRetry.ts), and this device's syncEngine intentionally keeps
 * its own last-verified-good state on disk when that happens rather than clearing it - retrying
 * processPendingWelcomes wouldn't help and could mask a real refusal behind a misleading
 * "still catching up" retry state.
 */
async function syncCommitsRecoveringMissingWelcome(
  syncEngine: SyncEngine,
  conversationId: ConversationId,
): Promise<void> {
  try {
    await syncEngine.syncCommits(conversationId);
  } catch (error) {
    if (!(error instanceof GroupStateUnavailableError)) throw error;
    await syncEngine.processPendingWelcomes();
    await syncEngine.syncCommits(conversationId);
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

/**
 * Decrypts a conversation's messages once each and caches the plaintext
 * locally forever after (threat-model §5: MLS deletes each message's key
 * right after one decrypt, so this is the only chance to ever read it).
 * A message this device itself sent is never re-decrypted - this device's
 * own copy of that generation's key is already gone by send time, so only
 * the local cache saved at send time can ever produce its content again.
 * A message another device of the same user sent is decrypted like any other
 * member's, which is how a message you send shows up on all of your devices.
 */
export function useDecryptedMessages(
  conversationId: ConversationId,
  messages: ChatMessageRow[],
  currentUserId: string | undefined,
): Record<string, DecryptedMessageState> {
  const syncEngine = useSyncEngine();
  const ownDeviceId = useDeviceIdentity().credential?.deviceId;
  const [decrypted, setDecrypted] = useState<Record<string, DecryptedMessageState>>({});
  // Message ids some still-running effect invocation has already claimed.
  // A ref (not per-invocation state) so it survives across re-runs: a new
  // message arriving while an older one is still mid-decrypt (a real
  // network round trip) re-triggers this effect before the older
  // invocation has saved its result to plaintextStore, so a fresh scan
  // would otherwise see that message as "not yet cached" and decrypt it a
  // second time - each MLS application message key is single-use, so the
  // second attempt fails and permanently reports "unavailable".
  const inFlightRef = useRef<Set<string>>(new Set());
  // Bumped by a timer to run the effect again for messages that couldn't be decrypted
  // only because catching up on commits failed.
  const [retryTick, setRetryTick] = useState(0);
  const retryAttemptsRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(retryTimerRef.current), []);

  // Another conversation starts with a clean slate: its own attempts, no timer left from the
  // last one, and none of the previous conversation's entries still sitting in state - this map
  // is never otherwise pruned, so without this it grows for the lifetime of the page as someone
  // switches between conversations. Nothing is lost: a cache hit against plaintextStore
  // repopulates any of these instantly the next time that conversation is reopened.
  useEffect(() => {
    retryAttemptsRef.current = 0;
    clearTimeout(retryTimerRef.current);
    setDecrypted({});
  }, [conversationId]);

  // Regaining connectivity is a stronger, more specific signal than "five timed retries have
  // simply elapsed": without this, a message that failed to sync during an outage longer than the
  // backoff schedule (5s, 10s, 20s, 40s, 60s) stays marked unavailable forever once the budget
  // runs out, even after the network comes back - nothing else re-triggers the effect for it
  // unless some unrelated event (a new message arriving) happens to. Resets the budget and forces
  // an immediate rescan instead. Still safe for a genuinely refused commit: shouldRetryDecrypt
  // already keeps that class of failure from ever being scheduled as a timed retry in the first
  // place, so this can only revisit messages an outage - not a real refusal - left stuck.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handleOnline = () => {
      retryAttemptsRef.current = 0;
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

    void (async () => {
      // Cache hits - including a message this device just sent and cached
      // at send time - never needed a network round trip to resolve at
      // all. Checking them all up front, before syncCommits below, means
      // the sender's own message (and anything already decrypted before)
      // shows up immediately instead of flashing "Decrypting..." while
      // waiting on a sync that has nothing to do with it.
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
            // Sent from this device with no local copy left (a cleared profile): this
            // device's key for it is gone, so there is no decrypting it again from here.
            setDecrypted((prev) => ({ ...prev, [message.id]: { status: 'unavailable' } }));
            return;
          }

          if (inFlightRef.current.has(message.id)) {
            // Another still-running invocation already claimed this one -
            // its own setDecrypted call will resolve it; reprocessing here
            // would just burn the message's one-time key for nothing.
            return;
          }

          pendingIncoming.push(message);
        }),
      );

      if (pendingIncoming.length === 0 || cancelled) {
        return;
      }

      for (const message of pendingIncoming) {
        inFlightRef.current.add(message.id);
      }

      const wireBytesByMessageId = new Map(
        pendingIncoming.map((message) => [message.id, base64ToBytes(message.ciphertext)]),
      );

      // syncCommits is a real network round trip whose only job is to catch
      // this device up on commits it missed - unnecessary (and, on the hot
      // path of ordinary chatting, the common case) whenever every pending
      // message was already framed under the epoch this session is at.
      // Skipping it here doesn't skip anything MLS-meaningful: it only
      // takes effect when there was nothing to catch up on in the first
      // place, and falls back to the exact previous behavior otherwise.
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
      const retryable = shouldRetryDecrypt(syncError, retryAttemptsRef.current);

      // Every setDecrypted below runs unconditionally, cancelled or not: once a message reaches
      // this point it's already claimed in inFlightRef (nothing else will ever attempt it again),
      // decrypting it consumes its one-time key whether or not a newer effect run has since
      // superseded this one, and each write only touches its own message's slot - so a "stale"
      // run's result is not stale data, it's the one and only outcome that will ever exist for
      // that message. Suppressing it here used to mean the outcome was computed, the plaintext
      // was already saved to plaintextStore, and the message still never showed up in the UI
      // until some unrelated, later effect run happened to re-scan and find it in the cache.
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

      if (!needsRetry) {
        retryAttemptsRef.current = 0;
      } else {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = setTimeout(
          () => setRetryTick((tick) => tick + 1),
          nextRetryDelayMs(retryAttemptsRef.current),
        );
        retryAttemptsRef.current += 1;
      }
    })();

    return () => {
      cancelled = true;
    };
    // messages is a fresh array reference on every fetch even when the
    // underlying content hasn't changed - keying off the id list (not
    // `messages` itself) keeps this from re-running on every unrelated
    // re-render, e.g. from an unrelated parent state update.
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
