import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BlocksService } from '../blocks/blocks.service';
import { EventPublisherPort } from '../domain-events/event-publisher.port';
import { PrismaService } from '../prisma/prisma.service';
import { ProfileAccessService } from '../profile-access/profile-access.service';
import type { ListFollowsQueryDto } from './dto/list-follows-query.dto';
import { FollowsRepository } from './follows.repository';

@Injectable()
export class FollowsService {
  constructor(
    private readonly followsRepository: FollowsRepository,
    private readonly eventPublisher: EventPublisherPort,
    private readonly prisma: PrismaService,
    private readonly blocks: BlocksService,
    private readonly profileAccess: ProfileAccessService,
  ) {}

  async follow(followerId: string, followingId: string) {
    if (followerId === followingId) {
      throw new BadRequestException('You cannot follow yourself');
    }

    const targetUser =
      await this.followsRepository.findActiveUserById(followingId);

    if (!targetUser) {
      throw new NotFoundException('User not found');
    }

    const blocked = await this.blocks.getMutuallyBlockedIdsAmong(followerId, [
      followingId,
    ]);
    if (blocked.has(followingId)) {
      throw new ForbiddenException("You can't follow this user");
    }

    await this.prisma.$transaction(async (transaction) => {
      const result = await this.followsRepository.create(
        transaction,
        followerId,
        followingId,
      );

      if (result.count > 0) {
        await this.eventPublisher.publish(
          {
            type: 'user.followed',
            aggregateId: followingId,
            payload: {
              targetUserId: followingId,
              actorId: followerId,
            },
          },
          transaction,
        );
      }
    });

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

  /** Both directions at once, for a "would this become a message request" check. */
  async getFollowStatus(actorId: string, targetId: string) {
    const [following, followsMe] = await Promise.all([
      this.isFollowing(actorId, targetId),
      this.isFollowing(targetId, actorId),
    ]);

    return { following: following.following, followsMe: followsMe.following };
  }

  async getCounts(userId: string) {
    const [followers, following] = await Promise.all([
      this.followsRepository.countFollowers(userId),
      this.followsRepository.countFollowing(userId),
    ]);

    return { followers, following };
  }

  listFollowers(
    ownerId: string,
    viewerId: string | undefined,
    query: ListFollowsQueryDto,
  ) {
    return this.listPage(ownerId, viewerId, query, (take, cursor) =>
      this.followsRepository.findFollowersPage(ownerId, take, cursor),
    );
  }

  listFollowing(
    ownerId: string,
    viewerId: string | undefined,
    query: ListFollowsQueryDto,
  ) {
    return this.listPage(ownerId, viewerId, query, (take, cursor) =>
      this.followsRepository.findFollowingPage(ownerId, take, cursor),
    );
  }

  /** A page of people with how the viewer relates to each; anyone blocked either way with the viewer is left out. */
  private async listPage(
    ownerId: string,
    viewerId: string | undefined,
    { cursor, limit }: ListFollowsQueryDto,
    fetchPage: (
      take: number,
      cursor?: string,
    ) => Promise<
      {
        id: string;
        name: string;
        username: string | null;
        image: string | null;
      }[]
    >,
  ) {
    if (!(await this.followsRepository.findActiveUserById(ownerId))) {
      throw new NotFoundException('User not found');
    }
    await this.profileAccess.assertCanView(viewerId, ownerId);

    const rows = await fetchPage(limit + 1, cursor);
    const page = rows.slice(0, limit);
    const ids = page.map((person) => person.id);

    const [blocked, iFollow, followMe] = viewerId
      ? await Promise.all([
          this.blocks.getMutuallyBlockedIdsAmong(viewerId, ids),
          this.getFollowingIdsAmong(viewerId, ids),
          this.followsRepository.findFollowerIdsAmong(viewerId, ids),
        ])
      : [new Set<string>(), new Set<string>(), []];
    const followsMe = new Set(followMe);

    return {
      items: page
        .filter((person) => !blocked.has(person.id))
        .map((person) => ({
          ...person,
          isFollowing: iFollow.has(person.id),
          followsYou: followsMe.has(person.id),
        })),
      nextCursor: rows.length > limit ? (page.at(-1)?.id ?? null) : null,
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
