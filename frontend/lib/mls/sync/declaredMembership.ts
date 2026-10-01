import { bytesEqual } from '../bytes';
import type { DeviceId, MembershipChange, UserId } from '../contract/types';
import { base64ToBytes } from '../storage/base64';

/** Whose device an added leaf must be and the key it must carry - the server's registry, not the sender's word. */
export interface AttestedAddedDevice {
  deviceId: DeviceId;
  userId: UserId;
  signatureKey: Uint8Array;
}

/** Whose leaf a removed device was, from the server's roster. */
export interface AttestedRemovedDevice {
  deviceId: DeviceId;
  userId: UserId;
}

/**
 * What the server vouches for about a Commit's membership change, stored on
 * the handshake row and handed to every member that fetches it. The server
 * can't read a Commit, so it records which devices the sender said it adds
 * and removes and looks up, from its own records, whose each one is. Every
 * member checks the real Commit against that (threat-model §3: a mismatch is
 * a fault, never something to paper over).
 */
export interface DeclaredMembership {
  /** False for Commits accepted before membership was tracked: nothing was declared, so nothing can be checked. */
  membershipDeclared: boolean;
  addedDevices: AttestedAddedDevice[];
  removedDevices: AttestedRemovedDevice[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseAdded(value: unknown): AttestedAddedDevice | undefined {
  if (!isRecord(value)) return undefined;

  const { deviceId, userId, signaturePublicKey } = value;
  if (
    typeof deviceId !== 'string' ||
    typeof userId !== 'string' ||
    typeof signaturePublicKey !== 'string'
  ) {
    return undefined;
  }

  try {
    return { deviceId, userId, signatureKey: base64ToBytes(signaturePublicKey) };
  } catch {
    return undefined;
  }
}

function parseRemoved(value: unknown): AttestedRemovedDevice | undefined {
  if (!isRecord(value)) return undefined;

  const { deviceId, userId } = value;
  return typeof deviceId === 'string' && typeof userId === 'string'
    ? { deviceId, userId }
    : undefined;
}

function parseAll<T>(value: unknown, parseOne: (item: unknown) => T | undefined): T[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const parsed = value.map(parseOne);
  return parsed.every((item): item is T => item !== undefined) ? parsed : undefined;
}

/**
 * Reads the declaration off a handshake row from the backend. Returns
 * undefined for anything that doesn't have the fields at all, so a response
 * that leaves them out can never be mistaken for "nothing to check".
 */
export function parseDeclaredMembership(handshake: unknown): DeclaredMembership | undefined {
  if (!isRecord(handshake)) return undefined;

  const { membershipDeclared } = handshake;
  const addedDevices = parseAll(handshake.addedDevices, parseAdded);
  const removedDevices = parseAll(handshake.removedDevices, parseRemoved);

  if (typeof membershipDeclared !== 'boolean' || !addedDevices || !removedDevices) {
    return undefined;
  }

  return { membershipDeclared, addedDevices, removedDevices };
}

function sameDevices(actual: readonly DeviceId[], attested: readonly DeviceId[]): boolean {
  if (actual.length !== attested.length) return false;

  const remaining = [...attested].sort();
  return [...actual].sort().every((deviceId, index) => deviceId === remaining[index]);
}

/**
 * Compares what a Commit actually did with what the server attested. Returns
 * a description of the difference, or undefined when they agree. It checks
 * the whole credential, not just the device id: a leaf that carries the right
 * id but a different owner or key would otherwise pass as that device and
 * keep receiving every future epoch's secrets - even after its real owner is
 * removed. Devices are compared as a multiset: adding the same device twice
 * is a difference.
 */
export function describeMembershipMismatch(
  actual: MembershipChange | null,
  declared: DeclaredMembership,
): string | undefined {
  if (!declared.membershipDeclared) return undefined;

  if (actual === null) {
    return 'the Commit did not report which devices it added or removed';
  }

  const actualAdded = actual.added.map((credential) => credential.deviceId);
  const actualRemoved = actual.removed.map((credential) => credential.deviceId);
  const attestedAdded = declared.addedDevices.map((device) => device.deviceId);
  const attestedRemoved = declared.removedDevices.map((device) => device.deviceId);

  if (!sameDevices(actualAdded, attestedAdded)) {
    return `it added [${actualAdded.join(', ')}] but the server recorded [${attestedAdded.join(', ')}]`;
  }

  if (!sameDevices(actualRemoved, attestedRemoved)) {
    return `it removed [${actualRemoved.join(', ')}] but the server recorded [${attestedRemoved.join(', ')}]`;
  }

  for (const leaf of actual.added) {
    const registered = declared.addedDevices.find((device) => device.deviceId === leaf.deviceId);

    if (!registered || registered.userId !== leaf.userId) {
      return `the leaf for ${leaf.deviceId} is labelled as user ${leaf.userId}, which is not that device's registered owner`;
    }

    if (!bytesEqual(registered.signatureKey, leaf.signatureKey)) {
      return `the leaf for ${leaf.deviceId} does not carry that device's registered key`;
    }
  }

  for (const leaf of actual.removed) {
    const recorded = declared.removedDevices.find((device) => device.deviceId === leaf.deviceId);

    if (!recorded || recorded.userId !== leaf.userId) {
      return `the removed leaf for ${leaf.deviceId} is labelled as user ${leaf.userId}, not the user the server recorded`;
    }
  }

  return undefined;
}
