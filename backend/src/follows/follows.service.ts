import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FollowsRepository } from './follows.repository';

@Injectable()
export class FollowsService {
  constructor(private readonly followsRepository: FollowsRepository) {}

  async follow(followerId: string, followingId: string) {
    if (followerId === followingId) {
      throw new BadRequestException('You cannot follow yourself');
    }

    const targetUser =
      await this.followsRepository.findActiveUserById(followingId);

    if (!targetUser) {
      throw new NotFoundException('User not found');
    }

    const existing = await this.followsRepository.find(followerId, followingId);

    // Keep follow endpoint idempotent.
    if (existing) {
      return {
        following: true,
      };
    }

    await this.followsRepository.create(followerId, followingId);

    return {
      following: true,
    };
  }

  async unfollow(followerId: string, followingId: string) {
    await this.followsRepository.delete(followerId, followingId);

    return {
      following: false,
    };
  }

  async isFollowing(followerId: string, followingId: string) {
    const follow = await this.followsRepository.find(followerId, followingId);

    return {
      following: follow !== null,
    };
  }

  /**
   * Feed helper.
   *
   * Converts matching follow rows to a Set
   * for cheap O(1) checks during ranking.
   */
  async getFollowingIdsAmong(
    userId: string,
    candidateAuthorIds: string[],
  ): Promise<Set<string>> {
    const uniqueAuthorIds = [...new Set(candidateAuthorIds)];

    const follows = await this.followsRepository.findFollowingIdsAmong(
      userId,
      uniqueAuthorIds,
    );

    return new Set(follows.map((follow) => follow.followingId));
  }
}
