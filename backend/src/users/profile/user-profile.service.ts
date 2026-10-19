import { Injectable, NotFoundException } from '@nestjs/common';
import { BlocksService } from '../../blocks/blocks.service';
import { FollowsService } from '../../follows/follows.service';
import { PostsService } from '../../posts/posts.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ProfileAccessService } from '../../profile-access/profile-access.service';

/** A person's public profile: who they are, their counts, and how the viewer relates to them. */
@Injectable()
export class UserProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly blocks: BlocksService,
    private readonly follows: FollowsService,
    private readonly posts: PostsService,
    private readonly profileAccess: ProfileAccessService,
  ) {}

  async getPublicProfile(userId: string, viewerId?: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, status: 'ACTIVE' },
      select: {
        id: true,
        name: true,
        username: true,
        image: true,
        bannerPresetId: true,
        bio: true,
        createdAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const isOther = Boolean(viewerId) && viewerId !== userId;
    const [isBlockedByMe, relation, canView] = await Promise.all([
      isOther && viewerId ? this.blocks.isBlocked(viewerId, userId) : false,
      isOther && viewerId
        ? this.follows.getFollowStatus(viewerId, userId)
        : null,
      this.profileAccess.canView(viewerId, userId),
    ]);

    const relationFields = {
      isBlockedByMe,
      isFollowing: relation?.following ?? false,
      followsYou: relation?.followsMe ?? false,
    };

    // Details of a profile the viewer may not see stay out of the answer.
    if (!canView) {
      return {
        ...user,
        bio: null,
        ...relationFields,
        isPrivate: true,
        counts: null,
      };
    }

    const [followCounts, postCount] = await Promise.all([
      this.follows.getCounts(userId),
      this.posts.countByAuthorPublic(userId, viewerId),
    ]);

    return {
      ...user,
      ...relationFields,
      isPrivate: false,
      counts: { posts: postCount, ...followCounts },
    };
  }
}
