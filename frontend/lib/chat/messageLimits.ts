import type { PlaintextEnvelope } from "../mls/contract/types";

export const MAX_CIPHERTEXT_CHARS = 20000;
// A conservative UI budget: leave room for MLS framing, authentication and base64 expansion.
// This is an app limit, not a claim that plaintext characters equal ciphertext characters.
export const MAX_MESSAGE_BYTES = 12000;
// Mirrors ChatMessageRateLimiterService on the backend: 6 sends or edits per 5 s per user.
export const SEND_LIMIT = 6;
export const SEND_WINDOW_MS = 5000;
// The server stamps a send when it arrives, a little after this tab sent it, so its window ends later.
export const SEND_ARRIVAL_MARGIN_MS = 500;

export function envelopeBytes(envelope: PlaintextEnvelope): number {
  return new TextEncoder().encode(JSON.stringify(envelope)).byteLength;
}

export function textMessageBytes(text: string): number {
  return envelopeBytes({ v: 1, type: "text", body: text });
}

export function assertMessageSize(envelope: PlaintextEnvelope): void {
  if (envelopeBytes(envelope) > MAX_MESSAGE_BYTES) {
    throw new Error(
      "Message is too long. Shorten the text or caption before sending (12,000 encoded bytes maximum). Accents and emoji use more space.",
    );
  }
}
