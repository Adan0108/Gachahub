import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import type { ChatParticipantState } from '../generated/prisma/client';
import type { ParticipantTransition } from '../chat/membership/apply-participant-transitions';
import {
  isEntitledToLeaf,
  isLeafRemovable,
} from '../chat/membership/leaf-entitlement';
import {
  resolveMembershipTransition,
  type MembershipEvent,
} from '../chat/membership/membership-state-machine';

/**
 * The rules an accepted Commit's membership change must follow. Pure: the
 * caller (MlsHandshakesRepository) loads the facts inside its transaction and
 * these decide whether the change is allowed, so every rule is testable
 * without a database.
 *
 * The server cannot read a Commit, so it cannot check what the Commit really
 * did. What it can check is that what the sender DECLARES is allowed: nobody
 * unauthorized gets added, nobody still entitled to be in the group gets
 * removed. Every other member's client then checks the declaration against
 * the Commit itself.
 */

export interface DeviceFact {
  id: string;
  userId: string;
  revokedAt: Date | null;
  /** The signing key the device registered; every key package it uploads must be signed with it. */
  signaturePublicKey: Uint8Array;
}

/** Whose device an added leaf must be, and which key it must carry - from the server's registry, not the sender. */
export type AttestedAddedDevice = {
  deviceId: string;
  userId: string;
  /** Base64. */
  signaturePublicKey: string;
};

/** Whose leaf a removed device was, from the server's roster. */
export type AttestedRemovedDevice = {
  deviceId: string;
  userId: string;
};

type StateByUserId = ReadonlyMap<string, ChatParticipantState>;

function hasDuplicates(ids: readonly string[]): boolean {
  return new Set(ids).size !== ids.length;
}

/** Shape checks that need no database: what was declared has to add up. */
export function assertDeclarationIsConsistent(params: {
  senderDeviceId: string;
  addedDeviceIds: readonly string[];
  removedDeviceIds: readonly string[];
  welcomeRecipientDeviceIds: readonly string[];
}): void {
  const {
    senderDeviceId,
    addedDeviceIds,
    removedDeviceIds,
    welcomeRecipientDeviceIds,
  } = params;

  if (
    hasDuplicates(addedDeviceIds) ||
    hasDuplicates(removedDeviceIds) ||
    hasDuplicates(welcomeRecipientDeviceIds)
  ) {
    throw new BadRequestException(
      'A device can appear only once in a Commit’s declared changes',
    );
  }

  const added = new Set(addedDeviceIds);

  if (
    added.size !== welcomeRecipientDeviceIds.length ||
    welcomeRecipientDeviceIds.some((deviceId) => !added.has(deviceId))
  ) {
    throw new BadRequestException(
      'Welcomes must be sent to exactly the devices the Commit adds',
    );
  }

  if (removedDeviceIds.some((deviceId) => added.has(deviceId))) {
    throw new BadRequestException(
      'A Commit cannot add and remove the same device',
    );
  }

  if (added.has(senderDeviceId) || removedDeviceIds.includes(senderDeviceId)) {
    throw new BadRequestException('A device cannot add or remove itself');
  }
}

/**
 * The device's user must still be an ACTIVE participant when the Commit is
 * accepted. The caller checked before the transaction started; a LEAVING or
 * DECLINED user still has devices in the group, so being in the group is not
 * enough on its own.
 */
export function assertSenderIsActiveParticipant(
  state: ChatParticipantState | undefined,
): void {
  if (state !== 'ACTIVE') {
    throw new ForbiddenException(
      'No longer an active member of this conversation',
    );
  }
}

/** Only a device that is itself in the group can change it. */
export function assertSenderIsMember(
  activeLeafDeviceIds: ReadonlySet<string>,
  senderDeviceId: string,
): void {
  if (!activeLeafDeviceIds.has(senderDeviceId)) {
    throw new ForbiddenException('This device is not a member of the group');
  }
}

export function assertAddedDevicesAuthorized(params: {
  addedDeviceIds: readonly string[];
  deviceById: ReadonlyMap<string, DeviceFact>;
  participantStateByUserId: StateByUserId;
  activeLeafDeviceIds: ReadonlySet<string>;
}): void {
  const {
    addedDeviceIds,
    deviceById,
    participantStateByUserId,
    activeLeafDeviceIds,
  } = params;

  for (const deviceId of addedDeviceIds) {
    const device = deviceById.get(deviceId);

    if (!device) {
      throw new BadRequestException(`Unknown recipient device: ${deviceId}`);
    }

    // The consumption side (assertOwnActiveDevice) already stops a revoked
    // device from ever fetching a Welcome - this keeps one from being created.
    if (device.revokedAt) {
      throw new BadRequestException(`Recipient device is revoked: ${deviceId}`);
    }

    if (activeLeafDeviceIds.has(deviceId)) {
      throw new ConflictException(
        `Device is already in the group: ${deviceId}`,
      );
    }

    if (!isEntitledToLeaf(participantStateByUserId.get(device.userId))) {
      throw new ForbiddenException(
        `User ${device.userId} is not authorized to join this conversation`,
      );
    }
  }
}

/**
 * A device may be removed if it is not in the group, or its owner has no
 * further right to be there (leaving, gone, never accepted) or the device
 * itself is gone or revoked. Anything else would let a member evict a
 * legitimate participant through the server.
 */
export function assertRemovedDevicesRemovable(params: {
  removedDeviceIds: readonly string[];
  /** The devices currently in the group, by device id. */
  activeLeafUserIdByDeviceId: ReadonlyMap<string, string>;
  deviceById: ReadonlyMap<string, DeviceFact>;
  participantStateByUserId: StateByUserId;
}): void {
  const {
    removedDeviceIds,
    activeLeafUserIdByDeviceId,
    deviceById,
    participantStateByUserId,
  } = params;

  for (const deviceId of removedDeviceIds) {
    const userId = activeLeafUserIdByDeviceId.get(deviceId);

    if (userId === undefined) {
      throw new BadRequestException(`Device is not in the group: ${deviceId}`);
    }

    const device = deviceById.get(deviceId);

    if (
      !isLeafRemovable({
        ownerState: participantStateByUserId.get(userId),
        deviceIsGone: !device || device.revokedAt !== null,
      })
    ) {
      throw new ForbiddenException(
        `Device ${deviceId} is still authorized to be in this group`,
      );
    }
  }
}

/**
 * What the server vouches for about a Commit's membership change, taken from
 * its own records. Members compare the real Commit with THIS - not with what
 * the sender said - so a leaf that carries the right device id but a different
 * owner or key (a "ghost leaf") is caught. Call only after the added and
 * removed devices have been validated.
 */
export function attestMembershipChange(params: {
  addedDeviceIds: readonly string[];
  removedDeviceIds: readonly string[];
  deviceById: ReadonlyMap<string, DeviceFact>;
  activeLeafUserIdByDeviceId: ReadonlyMap<string, string>;
}): {
  addedDevices: AttestedAddedDevice[];
  removedDevices: AttestedRemovedDevice[];
} {
  const {
    addedDeviceIds,
    removedDeviceIds,
    deviceById,
    activeLeafUserIdByDeviceId,
  } = params;

  return {
    addedDevices: addedDeviceIds.map((deviceId) => {
      const device = deviceById.get(deviceId)!;

      return {
        deviceId,
        userId: device.userId,
        signaturePublicKey: Buffer.from(device.signaturePublicKey).toString(
          'base64',
        ),
      };
    }),
    removedDevices: removedDeviceIds.map((deviceId) => ({
      deviceId,
      userId: activeLeafUserIdByDeviceId.get(deviceId)!,
    })),
  };
}

/**
 * The participant state changes an accepted Commit completes, as decided by
 * the membership state machine: someone waiting to join becomes ACTIVE, someone
 * being removed becomes DECLINED once their last device is gone, and - when
 * this Commit created the group - anyone ACTIVE without a device in it goes to
 * JOINING until one is added.
 */
export function planCommitTransitions(params: {
  participantStateByUserId: StateByUserId;
  /** Users who gained a device in this Commit. */
  addedUserIds: Iterable<string>;
  /** Users who lost a device in this Commit and have none left. */
  fullyRemovedUserIds: Iterable<string>;
  /** Users with a device in the group after this Commit. */
  userIdsWithDevices: ReadonlySet<string>;
  groupJustActivated: boolean;
}): ParticipantTransition[] {
  const {
    participantStateByUserId,
    addedUserIds,
    fullyRemovedUserIds,
    userIdsWithDevices,
    groupJustActivated,
  } = params;

  const events = new Map<string, MembershipEvent>();

  for (const userId of addedUserIds) {
    events.set(userId, 'COMMIT_ADDED');
  }

  for (const userId of fullyRemovedUserIds) {
    // Only someone actually being removed finishes leaving. A user who merely
    // lost one device to revocation while still a member stays as they are.
    const state = participantStateByUserId.get(userId);
    if (state === 'LEAVING' || state === 'DECLINED') {
      events.set(userId, 'COMMIT_REMOVED');
    }
  }

  // Anyone still marked LEAVING with no device in the group has nothing left to
  // wait for. Finishing them here means a removal that can no longer complete
  // never keeps blocking sends, since LEAVING blocks them until it clears.
  for (const [userId, state] of participantStateByUserId) {
    if (state === 'LEAVING' && !userIdsWithDevices.has(userId)) {
      events.set(userId, 'COMMIT_REMOVED');
    }
  }

  if (groupJustActivated) {
    for (const [userId, state] of participantStateByUserId) {
      if (
        state === 'ACTIVE' &&
        !userIdsWithDevices.has(userId) &&
        !events.has(userId)
      ) {
        events.set(userId, 'GROUP_ACTIVATED');
      }
    }
  }

  const transitions: ParticipantTransition[] = [];

  for (const [userId, event] of events) {
    const from = participantStateByUserId.get(userId);
    const transition = resolveMembershipTransition({
      from: from ?? 'NONE',
      event,
      mlsActive: true,
    });

    if (transition.kind === 'illegal' || from === undefined) {
      // Authorization of the added devices was already checked, so this means
      // the roster and the participant rows disagree - refuse the Commit
      // rather than leave them out of step.
      throw new ConflictException(
        `Cannot complete ${event} for user ${userId} in state ${from ?? 'NONE'}`,
      );
    }

    if (transition.kind === 'change') {
      transitions.push({ userId, from, to: transition.to });
    }
  }

  return transitions;
}
