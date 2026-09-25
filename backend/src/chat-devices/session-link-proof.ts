import {
  createHmac,
  createPublicKey,
  timingSafeEqual,
  verify,
} from 'node:crypto';

const CHALLENGE_TTL_MS = 60_000;
/** Prefixed to every signed challenge so the device key can never be tricked into signing an MLS structure. Duplicated in frontend deviceProvisioning.ts - keep in step. */
export const SESSION_LINK_LABEL = 'gachahub/session-link/v1\n';
// wraps a raw 32-byte Ed25519 public key into the DER form node expects
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

interface ChallengePayload {
  sessionId: string;
  deviceId: string;
  expiresAt: number;
}

function mac(secret: string, body: string): Buffer {
  return createHmac('sha256', secret).update(body).digest();
}

/** A challenge only this server could have made, good for one login and one device for a minute. Nothing is stored. */
export function issueLinkChallenge(
  secret: string,
  params: { sessionId: string; deviceId: string },
  now = Date.now(),
): string {
  const payload: ChallengePayload = {
    ...params,
    expiresAt: now + CHALLENGE_TTL_MS,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');

  return `${body}.${mac(secret, body).toString('base64url')}`;
}

export function isValidLinkChallenge(
  secret: string,
  challenge: string,
  expected: { sessionId: string; deviceId: string },
  now = Date.now(),
): boolean {
  const [body, tag, ...rest] = challenge.split('.');
  if (!body || !tag || rest.length > 0) return false;

  const actual = Buffer.from(tag, 'base64url');
  const wanted = mac(secret, body);
  if (actual.length !== wanted.length || !timingSafeEqual(actual, wanted)) {
    return false;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(body, 'base64url').toString(),
    ) as ChallengePayload;

    return (
      payload.sessionId === expected.sessionId &&
      payload.deviceId === expected.deviceId &&
      payload.expiresAt > now
    );
  } catch {
    return false;
  }
}

/** Whether `signature` (base64) is the device's Ed25519 signature over `message`. */
export function isValidDeviceSignature(
  publicKey: Uint8Array,
  message: string,
  signature: string,
): boolean {
  try {
    const key = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(publicKey)]),
      format: 'der',
      type: 'spki',
    });

    return verify(
      null,
      Buffer.from(message),
      key,
      Buffer.from(signature, 'base64'),
    );
  } catch {
    return false;
  }
}
