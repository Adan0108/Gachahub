import { BadRequestException, Injectable } from '@nestjs/common';
import { BlocksRepository } from './blocks.repository';

@Injectable()
export class BlocksService {
  constructor(private readonly blocksRepository: BlocksRepository) {}

  async isBlocked(blockerId: string, blockedId: string): Promise<boolean> {
    const block = await this.blocksRepository.find(blockerId, blockedId);
    return block !== null;
  }

  // one directional, never leaks whether the candidate blocked the caller back
  async getBlockedIdsAmong(
    blockerId: string,
    candidateIds: string[],
  ): Promise<Set<string>> {
    const blocks = await this.blocksRepository.findBlockedIdsAmong(
      blockerId,
      candidateIds,
    );

    return new Set(blocks.map((block) => block.blockedId));
  }

  /** Which of these people have blocked this person. Only for server-side decisions: never tell the blocked person. */
  async getBlockersAmong(
    blockedId: string,
    candidateIds: string[],
  ): Promise<Set<string>> {
    const rows = await this.blocksRepository.findBlockersAmong(
      blockedId,
      candidateIds,
    );

    return new Set(rows.map((row) => row.blockerId));
  }

  /** Everyone this person has blocked, newest first, for a list they can unblock from. */
  async listBlockedUsers(blockerId: string, limit = 200) {
    const blocks = await this.blocksRepository.findBlockedUsers(
      blockerId,
      limit,
    );

    return blocks.map((block) => ({
      ...block.blocked,
      blockedAt: block.createdAt,
    }));
  }

  /** Blocked in either direction - what a two-way visibility rule needs. Returns the other person of each block. */
  async getMutuallyBlockedIdsAmong(
    userId: string,
    candidateIds: string[],
  ): Promise<Set<string>> {
    const blocks = await this.blocksRepository.findBlocksBetween(
      userId,
      candidateIds,
    );

    return new Set(
      blocks.map((block) =>
        block.blockerId === userId ? block.blockedId : block.blockerId,
      ),
    );
  }

  block(blockerId: string, blockedId: string) {
    if (blockerId === blockedId) {
      throw new BadRequestException('You cannot block yourself');
    }

    return this.blocksRepository.create(blockerId, blockedId);
  }

  async unblock(blockerId: string, blockedId: string): Promise<number> {
    const result = await this.blocksRepository.delete(blockerId, blockedId);
    return result.count;
  }
}
