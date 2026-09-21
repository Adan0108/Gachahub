import type { DeviceId, MembershipChange } from '../contract/types';

/**
 * What the sender told the server a Commit does to the group, stored on the
 * handshake row and handed to every member that fetches it. The server can't
 * read a Commit, so this is a claim - one each member checks against what the
 * Commit actually did (threat-model §3: a mismatch is a fault, never something
 * to paper over).
 */
export interface DeclaredMembership {
  /** False for Commits accepted before membership was tracked: nothing was declared, so nothing can be checked. */
  membershipDeclared: boolean;
  addedDeviceIds: DeviceId[];
  removedDeviceIds: DeviceId[];
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/**
 * Reads the declaration off a handshake row from the backend. Returns
 * undefined for anything that doesn't have the fields at all, so a response
 * that leaves them out can never be mistaken for "nothing to check".
 */
export function parseDeclaredMembership(handshake: unknown): DeclaredMembership | undefined {
  if (typeof handshake !== 'object' || handshake === null) return undefined;

  const { membershipDeclared, addedDeviceIds, removedDeviceIds } = handshake as Record<
    string,
    unknown
  >;

  if (
    typeof membershipDeclared !== 'boolean' ||
    !isStringArray(addedDeviceIds) ||
    !isStringArray(removedDeviceIds)
  ) {
    return undefined;
  }

  return { membershipDeclared, addedDeviceIds, removedDeviceIds };
}

function sameDevices(actual: readonly DeviceId[], declared: readonly DeviceId[]): boolean {
  if (actual.length !== declared.length) return false;

  const remaining = [...declared].sort();
  return [...actual].sort().every((deviceId, index) => deviceId === remaining[index]);
}

/**
 * Compares what a Commit actually did with what its sender declared. Returns
 * a description of the difference, or undefined when they agree. Devices are
 * compared as a multiset: adding the same device twice is a difference.
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

  if (!sameDevices(actualAdded, declared.addedDeviceIds)) {
    return `it added [${actualAdded.join(', ')}] but declared [${declared.addedDeviceIds.join(', ')}]`;
  }

  if (!sameDevices(actualRemoved, declared.removedDeviceIds)) {
    return `it removed [${actualRemoved.join(', ')}] but declared [${declared.removedDeviceIds.join(', ')}]`;
  }

  return undefined;
}
