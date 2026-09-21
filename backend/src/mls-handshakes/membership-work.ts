import type { ChatParticipantState } from '../generated/prisma/client';

/** A device, and whose it is. */
export interface WorkDevice {
  userId: string;
  deviceId: string;
}

/**
 * The membership changes one conversation is waiting on, as far as the
 * requesting device can carry them out: devices to add (for people who have
 * been authorized to join) and devices to remove (for people being removed).
 * The device turns this into one Commit and submits it; the server's
 * acceptance of that Commit is what completes the change.
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

export interface DirtyConversation {
  id: string;
  mlsEpoch: number;
  /** Only the JOINING and LEAVING participants. */
  participants: Array<{ userId: string; state: ChatParticipantState }>;
  /** Every device currently in the group. */
  activeLeaves: WorkDevice[];
}

/**
 * Turns what the server knows about each conversation into the work a device
 * can do. Pure; the repository loads the facts.
 *
 * Adds are the unrevoked devices of JOINING users, minus any already in the
 * group. Removes are every device in the group belonging to a LEAVING user,
 * whether or not the device still exists. A conversation with nothing the
 * device can act on is left out - a JOINING user with no usable device is
 * reported on the conversation that does have other work, but never alone,
 * since there would be nothing for the caller to do about it.
 */
export function buildMembershipWork(params: {
  conversations: readonly DirtyConversation[];
  /** Unrevoked devices, for every user waiting to join in any of the conversations. */
  devicesOfJoiningUsers: readonly WorkDevice[];
}): MembershipWorkItem[] {
  const { conversations, devicesOfJoiningUsers } = params;

  const devicesByUserId = new Map<string, string[]>();
  for (const device of devicesOfJoiningUsers) {
    const deviceIds = devicesByUserId.get(device.userId) ?? [];
    deviceIds.push(device.deviceId);
    devicesByUserId.set(device.userId, deviceIds);
  }

  const items: MembershipWorkItem[] = [];

  for (const conversation of conversations) {
    const inGroup = new Set(
      conversation.activeLeaves.map((leaf) => leaf.deviceId),
    );
    const leavingUserIds = new Set(
      conversation.participants
        .filter((participant) => participant.state === 'LEAVING')
        .map((participant) => participant.userId),
    );

    const add: WorkDevice[] = [];
    const unreachableUserIds: string[] = [];

    for (const participant of conversation.participants) {
      if (participant.state !== 'JOINING') continue;

      const deviceIds = (devicesByUserId.get(participant.userId) ?? []).filter(
        (deviceId) => !inGroup.has(deviceId),
      );

      if (deviceIds.length === 0) {
        unreachableUserIds.push(participant.userId);
      }
      for (const deviceId of deviceIds) {
        add.push({ userId: participant.userId, deviceId });
      }
    }

    const remove = conversation.activeLeaves.filter((leaf) =>
      leavingUserIds.has(leaf.userId),
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
