import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { DirtyConversation, WorkDevice } from './membership-work';

/**
 * Reads what a device needs to know to finish membership changes: which of its
 * conversations have someone waiting to join or leave. Read-only - the changes
 * themselves are applied when the resulting Commit is accepted
 * (MlsHandshakesRepository.acceptHandshake).
 */
@Injectable()
export class MlsMembershipWorkRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Conversations, in id order after `after`, where this device is in the MLS
   * group, its user is an ACTIVE participant (only they may commit), and
   * someone is JOINING or LEAVING. Each comes with those participants and the
   * devices currently in the group.
   */
  async findConversationsNeedingWork(params: {
    deviceId: string;
    userId: string;
    after?: string;
    limit: number;
  }): Promise<DirtyConversation[]> {
    const { deviceId, userId, after, limit } = params;

    const rows = await this.prisma.chatConversation.findMany({
      where: {
        ...(after ? { id: { gt: after } } : {}),
        mlsMembers: { some: { deviceId, removedEpoch: null } },
        AND: [
          { participants: { some: { userId, state: 'ACTIVE' } } },
          {
            participants: {
              some: { state: { in: ['JOINING', 'LEAVING'] } },
            },
          },
        ],
      },
      orderBy: { id: 'asc' },
      take: limit,
      select: {
        id: true,
        mlsEpoch: true,
        participants: {
          where: { state: { in: ['JOINING', 'LEAVING'] } },
          select: { userId: true, state: true },
        },
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

  async findUnrevokedDevicesOfUsers(userIds: string[]): Promise<WorkDevice[]> {
    const devices = await this.prisma.chatDevice.findMany({
      where: { userId: { in: userIds }, revokedAt: null },
      select: { id: true, userId: true },
    });

    return devices.map((device) => ({
      userId: device.userId,
      deviceId: device.id,
    }));
  }
}
