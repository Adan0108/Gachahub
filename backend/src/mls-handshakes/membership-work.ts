import { MAX_DEVICES_PER_COMMIT } from './dto/submit-handshake.dto';
import type { ChatParticipantState } from '../generated/prisma/client';
import {
  isEntitledToLeaf,
  isLeafRemovable,
} from '../chat/membership/leaf-entitlement';

/** A device, and whose it is. */
export interface WorkDevice {
  userId: string;
  deviceId: string;
}

/**
 * The membership changes one conversation is waiting on, as far as the
 * requesting device can carry them out: devices to add (for people entitled
 * to be in the group) and devices to remove (for people who are not, or whose
 * device is gone). The device turns this into one Commit and submits it; the
 * server's acceptance of that Commit is what completes the change.
 */
export interface MembershipWorkItem {
  conversationId: string;
  /** The epoch the Commit must be built from. */
  epoch: number;
  add: WorkDevice[];
  remove: WorkDevice[];
  /** Waiting to join, but none of their devices can be added yet. */
  unreachableUserIds: string[];
}

/** Everything the server knows about one MLS conversation, all of it - never a filtered part. */
export interface ConversationFacts {
  id: string;
  mlsEpoch: number;
  participants: Array<{ userId: string; state: ChatParticipantState }>;
  /** Every device currently in the group. */
  activeLeaves: WorkDevice[];
}

export interface DeviceRecord extends WorkDevice {
  revoked: boolean;
}

/**
 * Turns what the server knows about each conversation into the work a device
 * can do, using the same entitlement rules the server enforces on a Commit
 * (chat/membership/leaf-entitlement.ts) - so anything a Commit may legitimately
 * do is something this can ask for, and nothing it asks for will be refused.
 *
 * - Add: every unrevoked device of an entitled user that is not in the group.
 *   This covers someone joining, a member's new device, and a device that had
 *   no key package when its owner joined. A PENDING invitee the requester may
 *   not claim key packages for (see refusingInviteeIds) is left out.
 * - Remove: every device in the group whose owner is not entitled, or whose
 *   device is revoked or gone. This covers someone leaving, a lost or stolen
 *   device, and a leftover device of a user who is no longer a member.
 *
 * A Commit changes at most MAX_DEVICES_PER_COMMIT devices each way, so a
 * larger backlog is handed out in chunks (lowest device ids first): once one
 * Commit lands, the next poll yields the rest.
 *
 * Needs the conversation's COMPLETE participant list: a member left out would
 * look like someone with no right to be there.
 */
export function buildMembershipWork(params: {
  conversations: readonly ConversationFacts[];
  /** Every device of the entitled users and every device in the groups, revoked or not. Missing means deleted. */
  devices: readonly DeviceRecord[];
  /** The device asking; it can never remove itself. */
  requestingDeviceId: string;
  /** PENDING invitees the requester's claim would be refused for (they block, are blocked, or take no messages). */
  refusingInviteeIds?: ReadonlySet<string>;
}): MembershipWorkItem[] {
  const {
    conversations,
    devices,
    requestingDeviceId,
    refusingInviteeIds = new Set<string>(),
  } = params;

  const unrevokedDeviceIds = new Set(
    devices
      .filter((device) => !device.revoked)
      .map((device) => device.deviceId),
  );
  const unrevokedDeviceIdsByUser = new Map<string, string[]>();
  for (const device of devices) {
    if (device.revoked) continue;

    const deviceIds = unrevokedDeviceIdsByUser.get(device.userId) ?? [];
    deviceIds.push(device.deviceId);
    unrevokedDeviceIdsByUser.set(device.userId, deviceIds);
  }

  const items: MembershipWorkItem[] = [];

  for (const conversation of conversations) {
    const stateByUserId = new Map(
      conversation.participants.map((participant) => [
        participant.userId,
        participant.state,
      ]),
    );
    const inGroup = new Set(
      conversation.activeLeaves.map((leaf) => leaf.deviceId),
    );

    const add: WorkDevice[] = [];
    const unreachableUserIds: string[] = [];

    for (const participant of conversation.participants) {
      if (!isEntitledToLeaf(participant.state)) continue;
      if (
        participant.state === 'PENDING' &&
        refusingInviteeIds.has(participant.userId)
      ) {
        continue;
      }

      const userDeviceIds =
        unrevokedDeviceIdsByUser.get(participant.userId) ?? [];

      if (participant.state === 'JOINING' && userDeviceIds.length === 0) {
        unreachableUserIds.push(participant.userId);
      }

      for (const deviceId of userDeviceIds) {
        if (!inGroup.has(deviceId)) {
          add.push({ userId: participant.userId, deviceId });
        }
      }
    }

    const remove = conversation.activeLeaves.filter(
      (leaf) =>
        leaf.deviceId !== requestingDeviceId &&
        isLeafRemovable({
          ownerState: stateByUserId.get(leaf.userId),
          deviceIsGone: !unrevokedDeviceIds.has(leaf.deviceId),
        }),
    );

    if (add.length === 0 && remove.length === 0) {
      continue;
    }

    const firstChunk = (devices: WorkDevice[]) =>
      [...devices]
        .sort((a, b) => compareIds(a.deviceId, b.deviceId))
        .slice(0, MAX_DEVICES_PER_COMMIT);

    items.push({
      conversationId: conversation.id,
      epoch: conversation.mlsEpoch,
      add: firstChunk(add),
      remove: firstChunk(remove),
      unreachableUserIds,
    });
  }

  return items;
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
