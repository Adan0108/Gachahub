'use client';

import { useEffect, useState } from 'react';
import { useSyncEngine } from './useSyncEngine';
import { base64ToBytes } from '../lib/mls/storage/base64';
import { EncryptedIndexedDbMessagePlaintextStore } from '../lib/mls/storage/messagePlaintextStore';
import type { ConversationId, PlaintextEnvelope } from '../lib/mls/contract/types';

const plaintextStore = new EncryptedIndexedDbMessagePlaintextStore();

export type DecryptedMessageState =
  | { status: 'pending' }
  | { status: 'ok'; envelope: PlaintextEnvelope }
  /** Genuinely gone on this device - wrong key generation, missing history, or a decode failure. Not retried automatically. */
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

          pendingIncoming.push(message);
        }),
      );

      if (pendingIncoming.length === 0 || cancelled) {
        return;
      }

      try {
        await syncEngine.syncCommits(conversationId);
      } catch (error) {
        console.warn('Could not sync MLS commits before decrypting messages', error);
      }

      await Promise.all(
        pendingIncoming.map(async (message) => {
          try {
            const result = await syncEngine.processIncoming(
              conversationId,
              base64ToBytes(message.ciphertext),
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
            if (!cancelled) {
              setDecrypted((prev) => ({ ...prev, [message.id]: { status: 'unavailable' } }));
            }
          }
        }),
      );
    })();

    return () => {
      cancelled = true;
    };
    // messages is a fresh array reference on every fetch even when the
    // underlying content hasn't changed - keying off the id list (not
    // `messages` itself) keeps this from re-running on every unrelated
    // re-render, e.g. from an unrelated parent state update.
  }, [syncEngine, conversationId, messages.map((message) => message.id).join(','), currentUserId]);

  return decrypted;
}
