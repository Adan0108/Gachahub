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

/** The membership changes one conversation is waiting on, as far as the requesting device can carry them out. */
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

/** Turns what the server knows about each conversation into the add/remove work a device can do, capped at MAX_DEVICES_PER_COMMIT each way (lowest ids first); needs the COMPLETE participant list. */
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
