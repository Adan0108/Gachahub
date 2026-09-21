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
 *   no key package when its owner joined.
 * - Remove: every device in the group whose owner is not entitled, or whose
 *   device is revoked or gone. This covers someone leaving, a lost or stolen
 *   device, and a leftover device of a user who is no longer a member.
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
}): MembershipWorkItem[] {
  const { conversations, devices, requestingDeviceId } = params;

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

    items.push({
      conversationId: conversation.id,
      epoch: conversation.mlsEpoch,
      add,
      remove,
      unreachableUserIds,
    });
  }

  return items;
}
