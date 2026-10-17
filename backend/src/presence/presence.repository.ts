import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PRESENCE_AUDIENCE_LIMIT } from './presence.constants';

/** Who may see whose presence: people in an accepted chat together, with no block either way. */
@Injectable()
export class PresenceRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** The people who share an accepted chat with this person and are not blocked from them either way. */
  async findAudienceIds(userId: string): Promise<string[]> {
    const sharing = await this.findSharingChatIds(userId);
    return this.withoutBlocks(userId, sharing);
  }

  /** Of these people, the ones this viewer may see presence for. */
  async findVisibleAmong(
    viewerId: string,
    candidateIds: string[],
  ): Promise<Set<string>> {
    if (candidateIds.length === 0) return new Set();

    const sharing = await this.findSharingChatIds(viewerId, candidateIds);
    return new Set(await this.withoutBlocks(viewerId, sharing));
  }

  private async findSharingChatIds(
    userId: string,
    among?: string[],
  ): Promise<string[]> {
    const rows = await this.prisma.chatParticipant.findMany({
      where: {
        userId: among ? { in: among, not: userId } : { not: userId },
        state: 'ACTIVE',
        deletedAt: null,
        conversation: {
          participants: {
            some: { userId, state: 'ACTIVE', deletedAt: null },
          },
        },
      },
      select: { userId: true },
      distinct: ['userId'],
      take: PRESENCE_AUDIENCE_LIMIT,
    });

    return rows.map((row) => row.userId);
  }

  private async withoutBlocks(
    userId: string,
    candidateIds: string[],
  ): Promise<string[]> {
    if (candidateIds.length === 0) return [];

    const blocks = await this.prisma.chatUserBlock.findMany({
      where: {
        OR: [
          { blockerId: userId, blockedId: { in: candidateIds } },
          { blockedId: userId, blockerId: { in: candidateIds } },
        ],
      },
      select: { blockerId: true, blockedId: true },
    });
    const blocked = new Set(
      blocks.map((block) =>
        block.blockerId === userId ? block.blockedId : block.blockerId,
      ),
    );

    return candidateIds.filter((id) => !blocked.has(id));
  }
}
