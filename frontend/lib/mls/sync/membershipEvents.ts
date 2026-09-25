import type {
  ConversationId,
  DeviceCredential,
  DeviceId,
  DeviceIdentity,
  Epoch,
  UserId,
} from '../contract/types';

/** A membership change this device verified itself, kept to show in the thread. */
export type MembershipEventKind = 'joined' | 'left' | 'device-added';

export interface MembershipEvent {
  /** Stable per commit and person, so re-applying the same commit never duplicates it. */
  id: string;
  conversationId: ConversationId;
  epoch: Epoch;
  kind: MembershipEventKind;
  userId: UserId;
  deviceId?: DeviceId;
  /** When the commit happened: the server's handshake time, else when this device verified it (ms). */
  at: number;
}

interface DeriveInput {
  conversationId: ConversationId;
  epoch: Epoch;
  at: number;
  change: { added: DeviceIdentity[]; removed: DeviceIdentity[] };
  /** Every device in the group after the commit; undefined when a leaf could not be read. */
  leavesAfter: DeviceCredential[] | undefined;
  ownDeviceId: DeviceId;
}

function groupByUser(devices: DeviceIdentity[]): Map<UserId, DeviceIdentity[]> {
  const byUser = new Map<UserId, DeviceIdentity[]>();
  for (const device of devices) {
    byUser.set(device.userId, [...(byUser.get(device.userId) ?? []), device]);
  }
  return byUser;
}

/**
 * What a verified commit means for people: a first device is a join, a last device gone is a
 * leave, and any further device of someone already in is a new sign-in. A removed extra device
 * says nothing about the person, so it prints nothing.
 */
export function deriveMembershipEvents(input: DeriveInput): MembershipEvent[] {
  const { conversationId, epoch, at, change, leavesAfter, ownDeviceId } = input;
  if (!leavesAfter) return [];

  const devicesAfter = (userId: UserId) =>
    leavesAfter.filter((leaf) => leaf.userId === userId).length;
  const event = (kind: MembershipEventKind, device: DeviceIdentity): MembershipEvent => ({
    id: `${epoch}:${kind}:${device.userId}:${device.deviceId}`,
    conversationId,
    epoch,
    kind,
    userId: device.userId,
    deviceId: device.deviceId,
    at,
  });

  const events: MembershipEvent[] = [];
  const added = groupByUser(change.added);
  const removed = groupByUser(change.removed);

  for (const [userId, devices] of added) {
    const before = devicesAfter(userId) - devices.length + (removed.get(userId)?.length ?? 0);
    const others = devices.filter((device) => device.deviceId !== ownDeviceId);
    if (before === 0 && others[0]) events.push(event('joined', others[0]));
    else if (before > 0) events.push(...others.map((device) => event('device-added', device)));
  }
  for (const [userId, devices] of removed) {
    if (devicesAfter(userId) === 0) events.push(event('left', devices[0]!));
  }
  return events;
}
