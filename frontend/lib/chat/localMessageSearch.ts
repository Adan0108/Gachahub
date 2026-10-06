import {
  EncryptedIndexedDbMessagePlaintextStore,
  onMessageRemoved,
  onMessageSaved,
} from '../mls/storage/messagePlaintextStore';
import { registerSessionCleanup } from '../sessionCleanup';
import { MessageSearchIndex } from './messageSearchIndex';

/** The one search index for this tab; it is only filled while something holds it (see acquire). */
export const localMessageSearchIndex = new MessageSearchIndex();

// Decrypted text in memory: forget it on sign-out, not only when the search screen unmounts.
registerSessionCleanup(() => localMessageSearchIndex.clear());

const plaintextStore = new EncryptedIndexedDbMessagePlaintextStore();
let holders = 0;
let stopListening: (() => void) | null = null;

/**
 * Starts indexing this device's decrypted messages, and keeps the index current, until every
 * holder has released it; the last release empties it so no plaintext outlives the search screen.
 */
export function acquireMessageSearchIndex(): () => void {
  holders += 1;
  if (holders === 1) {
    const stops = [
      onMessageSaved((message) => localMessageSearchIndex.add(message)),
      onMessageRemoved((messageId) => localMessageSearchIndex.remove(messageId)),
    ];
    stopListening = () => stops.forEach((stop) => stop());
    void localMessageSearchIndex.syncWith(plaintextStore);
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    holders -= 1;
    if (holders > 0) return;
    stopListening?.();
    stopListening = null;
    localMessageSearchIndex.clear();
  };
}
