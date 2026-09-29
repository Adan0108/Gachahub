import { readStoredJson } from './preferences';

const KEY_PREFIX = 'gachahub-hidden-messages:';

/** Message ids this device has locally hidden ("delete for me"); never touches the server or other devices. */
export function getHiddenMessageIds(conversationId: string): Set<string> {
  return new Set(readStoredJson(`${KEY_PREFIX}${conversationId}`, []));
}

function writeHiddenMessageIds(conversationId: string, ids: Set<string>): void {
  try {
    window.localStorage.setItem(`${KEY_PREFIX}${conversationId}`, JSON.stringify([...ids]));
  } catch {
    // best-effort only - a full/blocked localStorage just means it isn't remembered next reload
  }
}

export function hideMessageForMe(conversationId: string, messageId: string): void {
  const ids = getHiddenMessageIds(conversationId);
  ids.add(messageId);
  writeHiddenMessageIds(conversationId, ids);
}

/** Undoes a "delete for me" - the message reappears on this device; other devices were never affected. */
export function unhideMessageForMe(conversationId: string, messageId: string): void {
  const ids = getHiddenMessageIds(conversationId);
  ids.delete(messageId);
  writeHiddenMessageIds(conversationId, ids);
}
