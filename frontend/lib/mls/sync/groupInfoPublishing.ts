import { bytesToBase64 } from '../storage/base64';

// The submit-handshake and external-join DTOs both cap the field at this length; past it the server
// refuses the whole request, not just the field, so BOTH paths that publish a snapshot must use this.
const MAX_GROUP_INFO_B64_CHARS = 60_000;

/**
 * Encodes a GroupInfo for the wire, or omits it entirely when it would be over the server's size cap.
 * Omitting is always safe: it only means self-join can't work for that group until a later, smaller
 * snapshot replaces it - the Commit or join this snapshot rides along with still goes through either way.
 */
export function publishableGroupInfo(bytes: Uint8Array): string | undefined {
  const encoded = bytesToBase64(bytes);
  return encoded.length <= MAX_GROUP_INFO_B64_CHARS ? encoded : undefined;
}
