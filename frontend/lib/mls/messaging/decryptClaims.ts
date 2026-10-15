// Messages being decrypted right now, by anyone on this device: a message key works once, so two runs must never both take one.
const held = new Map<string, Promise<void>>();

/** Takes the right to decrypt a message, or null while another run holds it. Call the returned function when done. */
export function claimDecrypt(messageId: string): (() => void) | null {
  if (held.has(messageId)) return null;

  let finished!: () => void;
  const done = new Promise<void>((resolve) => {
    finished = resolve;
  });
  held.set(messageId, done);

  return () => {
    if (held.get(messageId) === done) held.delete(messageId);
    finished();
  };
}

/** Settles when whoever holds the message lets go; undefined when nobody does. */
export function whenDecryptReleased(messageId: string): Promise<void> | undefined {
  return held.get(messageId);
}
