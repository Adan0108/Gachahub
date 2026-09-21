import { Injectable } from '@nestjs/common';
import type { ChatParticipantState } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { ConversationFacts, DeviceRecord } from './membership-work';

const PENDING_STATES: ChatParticipantState[] = ['JOINING', 'LEAVING'];

/**
 * How widely to look for membership work.
 * - `pending`: only conversations where someone is JOINING or LEAVING - cheap
 *   and indexed, meant to run often.
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
                    some: { state: { in: PENDING_STATES } },
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
