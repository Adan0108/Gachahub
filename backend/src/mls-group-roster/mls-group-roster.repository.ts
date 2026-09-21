import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface RosterLeaf {
  deviceId: string;
  userId: string;
}

/**
 * The server's record of which devices are leaves in a conversation's MLS
 * ratchet tree (MlsGroupMember). Lives in its own module so both ChatModule
 * and MlsHandshakesModule can use it without either importing the other.
 *
 * Every method takes an optional transaction client: the roster must change in
 * the same transaction as the Commit that changed the tree (see
 * MlsHandshakesRepository.acceptHandshake).
 */
@Injectable()
export class MlsGroupRosterRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Whether the conversation has an MLS group at all. Any row counts, live or
   * removed: once a conversation has been MLS-encrypted it stays that way, even
   * if every device has since been removed.
   */
  async hasRoster(
    conversationId: string,
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<boolean> {
    const member = await db.mlsGroupMember.findFirst({
      where: { conversationId },
      select: { id: true },
    });

    return member !== null;
  }

  /** The devices currently in the group. */
  findActiveLeaves(
    conversationId: string,
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<RosterLeaf[]> {
    return db.mlsGroupMember.findMany({
      where: { conversationId, removedEpoch: null },
      select: { deviceId: true, userId: true },
    });
  }

  /** Records devices joining at `addedEpoch`, the group's epoch after the Commit that added them. */
  async addLeaves(
    conversationId: string,
    leaves: RosterLeaf[],
    addedEpoch: number,
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<void> {
    if (leaves.length === 0) {
      return;
    }

    await db.mlsGroupMember.createMany({
      data: leaves.map((leaf) => ({
        conversationId,
        deviceId: leaf.deviceId,
        userId: leaf.userId,
        addedEpoch,
      })),
    });
  }

  /**
   * Marks devices as removed at `removedEpoch`. Returns how many live leaves
   * that matched, so a caller can tell if it was asked to remove one that
   * wasn't there.
   */
  async removeLeaves(
    conversationId: string,
    deviceIds: string[],
    removedEpoch: number,
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<number> {
    if (deviceIds.length === 0) {
      return 0;
    }

    const result = await db.mlsGroupMember.updateMany({
      where: {
        conversationId,
        deviceId: { in: deviceIds },
        removedEpoch: null,
      },
      data: { removedEpoch },
    });

    return result.count;
  }
}
