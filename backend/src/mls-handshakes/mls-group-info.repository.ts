import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Keeps, per conversation, the newest public snapshot of its MLS group (see MlsGroupInfo in the schema). */
@Injectable()
export class MlsGroupInfoRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Stores the snapshot unless a newer one is already there. Runs in the caller's transaction when given one. */
  async save(
    conversationId: string,
    epoch: number,
    payload: Uint8Array,
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<void> {
    const replaced = await db.mlsGroupInfo.updateMany({
      where: { conversationId, epoch: { lt: epoch } },
      data: { epoch, payload: payload.slice() },
    });

    if (replaced.count === 0) {
      await db.mlsGroupInfo.createMany({
        data: [{ conversationId, epoch, payload: payload.slice() }],
        skipDuplicates: true,
      });
    }
  }

  /** The snapshot, only while it describes the group's current epoch: an older one would make a join fail. */
  async findCurrent(
    conversationId: string,
  ): Promise<{ epoch: number; payload: Uint8Array } | null> {
    const conversation = await this.prisma.chatConversation.findUnique({
      where: { id: conversationId },
      select: {
        mlsEpoch: true,
        mlsGroupInfo: { select: { epoch: true, payload: true } },
      },
    });
    const info = conversation?.mlsGroupInfo;

    return info && info.epoch === conversation.mlsEpoch ? info : null;
  }
}
