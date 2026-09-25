import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ENTITLED_TO_LEAF_STATES } from '../chat/membership/leaf-entitlement';

/**
 * How widely to look for groups a device could join by itself.
 * - `pending`: only where the user is JOINING (someone who just accepted) - cheap, meant to run often.
 * - `full`: wherever the user is entitled to a leaf and this device is not in it, e.g. a new device.
 */
export type SelfJoinScope = 'pending' | 'full';

@Injectable()
export class MlsSelfJoinRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Conversations this user is entitled to be in, whose MLS group this device is not part of, and which
   * have a snapshot for the current epoch to join from.
   */
  async findJoinableConversationIds(params: {
    userId: string;
    deviceId: string;
    scope: SelfJoinScope;
    limit: number;
  }): Promise<string[]> {
    const { userId, deviceId, scope, limit } = params;
    const states = scope === 'pending' ? ['JOINING'] : ENTITLED_TO_LEAF_STATES;

    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT conversation."id"
      FROM "chat_conversations" AS conversation
      JOIN "chat_participants" AS participant
        ON participant."conversationId" = conversation."id"
       AND participant."userId" = ${userId}
      JOIN "mls_group_infos" AS snapshot
        ON snapshot."conversationId" = conversation."id"
       AND snapshot."epoch" = conversation."mlsEpoch"
      WHERE participant."state"::text IN (${Prisma.join([...states])})
        AND NOT EXISTS (
          SELECT 1 FROM "mls_group_members" AS member
          WHERE member."conversationId" = conversation."id"
            AND member."deviceId" = ${deviceId}
            AND member."removedEpoch" IS NULL
        )
      ORDER BY conversation."id"
      LIMIT ${limit}`;

    return rows.map((row) => row.id);
  }
}
