import { Injectable } from '@nestjs/common';
import type { ChatParticipantState } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { ConversationFacts, DeviceRecord } from './membership-work';

const STATES_NEEDING_WORK: ChatParticipantState[] = [
  'PENDING',
  'JOINING',
  'LEAVING',
];

/**
 * How widely to look for membership work.
 * - `pending`: only conversations where someone is PENDING, JOINING or
 *   LEAVING - cheap and indexed, meant to run often. PENDING is here so an
 *   invitee's device gets added promptly, not just on the rare full scan.
 * - `full`: every conversation this device is in, which also finds a new
 *   device, a revoked one, or a leftover one - meant to run rarely.
 */
export type MembershipWorkScope = 'pending' | 'full';

/**
 * Reads what a device needs to know to finish membership changes. Read-only -
 * the changes themselves are applied when the resulting Commit is accepted
 * (MlsHandshakesRepository.acceptHandshake).
 */
@Injectable()
export class MlsMembershipWorkRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Conversations, in id order after `after` (or just `conversationId`), where
   * this device is in the MLS group and its user is an ACTIVE participant (only
   * they may commit). Each comes with ALL its participants and the devices
   * currently in the group - never a filtered part, since a missing member
   * would look like someone with no right to be there.
   */
  async findConversationsNeedingWork(params: {
    deviceId: string;
    userId: string;
    scope: MembershipWorkScope;
    after?: string;
    /** Restrict to one conversation, e.g. the one a sender just found blocked. */
    conversationId?: string;
    limit: number;
  }): Promise<ConversationFacts[]> {
    const { deviceId, userId, scope, after, conversationId, limit } = params;

    const rows = await this.prisma.chatConversation.findMany({
      where: {
        ...(after ? { id: { gt: after } } : {}),
        ...(conversationId ? { id: conversationId } : {}),
        mlsMembers: { some: { deviceId, removedEpoch: null } },
        AND: [
          { participants: { some: { userId, state: 'ACTIVE' } } },
          ...(scope === 'pending'
            ? [
                {
                  participants: {
                    some: { state: { in: STATES_NEEDING_WORK } },
                  },
                },
              ]
            : []),
        ],
      },
      orderBy: { id: 'asc' },
      take: limit,
      select: {
        id: true,
        mlsEpoch: true,
        participants: { select: { userId: true, state: true } },
        mlsMembers: {
          where: { removedEpoch: null },
          select: { userId: true, deviceId: true },
        },
      },
    });

    return rows.map((row) => ({
      id: row.id,
      mlsEpoch: row.mlsEpoch,
      participants: row.participants,
      activeLeaves: row.mlsMembers,
    }));
  }

  /** Whether any conversation this device is in has someone half-joined or half-removed: the poll's cheap probe. */
  async hasPendingWork(deviceId: string, userId: string): Promise<boolean> {
    const row = await this.prisma.chatConversation.findFirst({
      where: {
        mlsMembers: { some: { deviceId, removedEpoch: null } },
        AND: [
          { participants: { some: { userId, state: 'ACTIVE' } } },
          { participants: { some: { state: { in: STATES_NEEDING_WORK } } } },
        ],
      },
      select: { id: true },
    });

    return row !== null;
  }

  /**
   * Hands these conversations to `deviceId` for a while and returns the ones it
   * now holds. A conversation another device holds a live lease on is left out,
   * so only one member at a time claims key packages for the same change -
   * otherwise every online member would, only one Commit could win, and the rest
   * of the single-use packages would be burned. A lease is never refreshed by
   * its holder: one that ends without a Commit (it lapsed or was released) is up
   * for grabs by everyone else at once, and by that device only after
   * `cooldownMs` - otherwise a device that cannot finish the work would keep it
   * from every other member for as long as its tab is open. A Commit clears the
   * lease, so a device that finishes the work is never held back.
   */
  async leaseConversations(params: {
    deviceId: string;
    conversationIds: string[];
    now: Date;
    until: Date;
    cooldownMs: number;
  }): Promise<Set<string>> {
    const { deviceId, conversationIds, now, until, cooldownMs } = params;
    const cooldownStart = new Date(now.getTime() - cooldownMs);

    await this.prisma.chatConversation.updateMany({
      where: {
        id: { in: conversationIds },
        OR: [
          { mlsWorkLeaseUntil: null },
          { mlsWorkLeaseUntil: { lt: cooldownStart } },
          {
            mlsWorkLeaseUntil: { lt: now },
            mlsWorkLeaseDeviceId: { not: deviceId },
          },
        ],
      },
      data: { mlsWorkLeaseDeviceId: deviceId, mlsWorkLeaseUntil: until },
    });

    const held = await this.prisma.chatConversation.findMany({
      where: {
        id: { in: conversationIds },
        mlsWorkLeaseDeviceId: deviceId,
        mlsWorkLeaseUntil: { gt: now },
      },
      select: { id: true },
    });

    return new Set(held.map((conversation) => conversation.id));
  }

  /**
   * Ends this device's lease on a conversation it could not finish work for, so
   * another member can take it now. The device stays the last holder, which is
   * what keeps it from taking the lease straight back.
   */
  async releaseLease(params: {
    deviceId: string;
    conversationId: string;
    now: Date;
  }): Promise<void> {
    await this.prisma.chatConversation.updateMany({
      where: {
        id: params.conversationId,
        mlsWorkLeaseDeviceId: params.deviceId,
      },
      data: { mlsWorkLeaseUntil: params.now },
    });
  }

  /** Every device of these users, plus these devices wherever they belong - revoked ones included, so a revoked leaf can be told from a working one. */
  async findDevices(params: {
    userIds: string[];
    deviceIds: string[];
  }): Promise<DeviceRecord[]> {
    const devices = await this.prisma.chatDevice.findMany({
      where: {
        OR: [
          { userId: { in: params.userIds } },
          { id: { in: params.deviceIds } },
        ],
      },
      select: { id: true, userId: true, revokedAt: true },
    });

    return devices.map((device) => ({
      userId: device.userId,
      deviceId: device.id,
      revoked: device.revokedAt !== null,
    }));
  }
}
