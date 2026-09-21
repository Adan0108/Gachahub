'use client';

import { useEffect, useRef, useState } from 'react';
import { useSyncEngine } from './useSyncEngine';
import { base64ToBytes } from '../lib/mls/storage/base64';
import { nextRetryDelayMs } from '../lib/mls/messaging/decryptRetry';
import { EncryptedIndexedDbMessagePlaintextStore } from '../lib/mls/storage/messagePlaintextStore';
import type { ConversationId, PlaintextEnvelope } from '../lib/mls/contract/types';

const plaintextStore = new EncryptedIndexedDbMessagePlaintextStore();

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
}

/**
 * Decrypts a conversation's messages once each and caches the plaintext
 * locally forever after (threat-model §5: MLS deletes each message's key
 * right after one decrypt, so this is the only chance to ever read it).
 * A message this device itself sent is never re-decrypted - the sender's
 * own copy of that generation's key is already gone by send time, so only
 * the local cache saved at send time (see useSendEncryptedMessage) can ever
 * produce its content again.
 */
export function useDecryptedMessages(
  conversationId: ConversationId,
  messages: ChatMessageRow[],
  currentUserId: string | undefined,
): Record<string, DecryptedMessageState> {
  const syncEngine = useSyncEngine();
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
            if (!cancelled) {
              setDecrypted((prev) => ({
                ...prev,
                [message.id]: { status: 'ok', envelope: cached.envelope },
              }));
            }
            return;
          }

          if (message.senderId === currentUserId) {
            // Our own message with no local cache (a different device/
            // session, or a cleared profile) - the sender's own ratchet
            // already consumed this generation's key at send time, so
            // there is no decrypting it again from here.
            if (!cancelled) {
              setDecrypted((prev) => ({ ...prev, [message.id]: { status: 'unavailable' } }));
            }
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

      let syncFailed = false;
      if (needsSync) {
        try {
          await syncEngine.syncCommits(conversationId);
        } catch (error) {
          syncFailed = true;
          console.warn('Could not sync MLS commits before decrypting messages', error);
        }
      }

      let needsRetry = false;
      await Promise.all(
        pendingIncoming.map(async (message) => {
          try {
            const result = await syncEngine.processIncoming(
              conversationId,
              wireBytesByMessageId.get(message.id)!,
            );
            if (result.kind !== 'application') {
              if (!cancelled) {
                setDecrypted((prev) => ({ ...prev, [message.id]: { status: 'unavailable' } }));
              }
              return;
            }
            await plaintextStore.save({
              messageId: message.id,
              conversationId,
              senderDeviceId: result.senderDeviceId,
              epoch: result.epoch,
              envelope: result.envelope,
            });
            if (!cancelled) {
              setDecrypted((prev) => ({
                ...prev,
                [message.id]: { status: 'ok', envelope: result.envelope },
              }));
            }
          } catch (error) {
            console.warn(`Could not decrypt message ${message.id}`, error);
            // Without the commit sync the message may just need a commit this device hasn't got yet.
            const status = syncFailed ? 'pending' : 'unavailable';
            needsRetry ||= syncFailed;
            if (!cancelled) {
              setDecrypted((prev) => ({ ...prev, [message.id]: { status } }));
            }
          } finally {
            inFlightRef.current.delete(message.id);
          }
        }),
      );

      if (!needsRetry) {
        retryAttemptsRef.current = 0;
      } else if (!cancelled) {
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
    retryTick,
  ]);

  return decrypted;
}
