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
