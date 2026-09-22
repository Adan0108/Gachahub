import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { ENTITLED_TO_LEAF_STATES } from '../chat/membership/leaf-entitlement';
import { PrismaService } from '../prisma/prisma.service';

/** How many examples of each problem to include in an alert. */
const SAMPLE_LIMIT = 20;
/** A removal not finished within a day has stalled - it blocks sends, someone should look. */
const LEAVING_STUCK_AFTER_MS = 24 * 60 * 60 * 1000;
/** Joins self-heal (welcome, self-join), so only a week-old one is worth an alarm. */
const JOINING_STUCK_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
/** Retired devices leave groups on the next full pass; only one lingering longer is wrong. */
const REVOKED_LEAF_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

export interface SuspectLeaf {
  conversationId: string;
  deviceId: string;
  userId: string;
}

export interface StuckParticipant {
  conversationId: string;
  userId: string;
  state: string;
}

/** Read-only queries for things that should never be true, so a bug (or a tampered server) gets noticed. */
@Injectable()
export class MlsAuditRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Devices sitting in a group's encryption whose device record is gone or retired. */
  findLeavesOfDeadDevices(): Promise<SuspectLeaf[]> {
    return this.prisma.$queryRaw<SuspectLeaf[]>`
      SELECT member."conversationId", member."deviceId", member."userId"
      FROM "mls_group_members" AS member
      LEFT JOIN "chat_devices" AS device ON device."id" = member."deviceId"
      WHERE member."removedEpoch" IS NULL
        AND (device."id" IS NULL
          OR device."revokedAt" < ${new Date(Date.now() - REVOKED_LEAF_GRACE_MS)})
      LIMIT ${SAMPLE_LIMIT}`;
  }

  /** Devices sitting in a group's encryption whose owner is not in that conversation any more (or never was). */
  findLeavesOfOutsiders(): Promise<SuspectLeaf[]> {
    return this.prisma.$queryRaw<SuspectLeaf[]>`
      SELECT member."conversationId", member."deviceId", member."userId"
      FROM "mls_group_members" AS member
      LEFT JOIN "chat_participants" AS participant
        ON participant."conversationId" = member."conversationId"
       AND participant."userId" = member."userId"
      WHERE member."removedEpoch" IS NULL
        AND (
          participant."id" IS NULL
          OR participant."state"::text NOT IN (${Prisma.join([...ENTITLED_TO_LEAF_STATES])})
        )
      LIMIT ${SAMPLE_LIMIT}`;
  }

  /** People stuck half-joined or half-removed for over a day: some change never finished. */
  async findStuckParticipants(): Promise<StuckParticipant[]> {
    const rows = await this.prisma.chatParticipant.findMany({
      where: {
        OR: [
          {
            state: 'LEAVING',
            updatedAt: { lt: new Date(Date.now() - LEAVING_STUCK_AFTER_MS) },
          },
          {
            state: 'JOINING',
            updatedAt: { lt: new Date(Date.now() - JOINING_STUCK_AFTER_MS) },
          },
        ],
      },
      select: { conversationId: true, userId: true, state: true },
      take: SAMPLE_LIMIT,
    });

    return rows.map((row) => ({ ...row, state: String(row.state) }));
  }
}
