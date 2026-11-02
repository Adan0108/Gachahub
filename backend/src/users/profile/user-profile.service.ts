import { Injectable, NotFoundException } from '@nestjs/common';
import { BlocksService } from '../../blocks/blocks.service';
import {
  ALL_EQUIPPED_COSMETICS_SELECT,
  toEquippedSlotsMap,
} from '../../cosmetics/cosmetic-starter-catalog';
import { FollowsService } from '../../follows/follows.service';
import type { Prisma } from '../../generated/prisma/client';
import { PostsService } from '../../posts/posts.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ProfileAccessService } from '../../profile-access/profile-access.service';

const BASE_PROFILE_SELECT = {
  id: true,
  name: true,
  username: true,
  image: true,
  bannerPresetId: true,
  wallet: { select: { reputation: true, rank: true } },
  equippedCosmetics: ALL_EQUIPPED_COSMETICS_SELECT,
} satisfies Prisma.UserSelect;

/** A person's public profile and hover card: who they are, their cosmetics, their counts, and how the viewer relates to them. */
@Injectable()
export class UserProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly blocks: BlocksService,
    private readonly follows: FollowsService,
    private readonly posts: PostsService,
    private readonly profileAccess: ProfileAccessService,
  ) {}

  private async resolveViewerRelation(
    viewerId: string | undefined,
    userId: string,
  ) {
    const isOther = Boolean(viewerId) && viewerId !== userId;
    const [isBlockedByMe, relation, canView] = await Promise.all([
      isOther && viewerId ? this.blocks.isBlocked(viewerId, userId) : false,
      isOther && viewerId
        ? this.follows.getFollowStatus(viewerId, userId)
        : null,
      this.profileAccess.canView(viewerId, userId),
    ]);
    return {
      canView,
      relationFields: {
        isBlockedByMe,
        isFollowing: relation?.following ?? false,
        followsYou: relation?.followsMe ?? false,
      },
    };
  }

  async getPublicProfile(userId: string, viewerId?: string) {
    const found = await this.prisma.user.findFirst({
      where: { id: userId, status: 'ACTIVE' },
      select: {
        ...BASE_PROFILE_SELECT,
        bio: true,
        createdAt: true,
      },
    });

    if (!found) {
      throw new NotFoundException('User not found');
    }

    // Rank, Reputation, and equipped cosmetics are public standing, shown even on a private profile.
    const { wallet, equippedCosmetics, ...rest } = found;
    const user = {
      ...rest,
      reputation: wallet?.reputation ?? 0,
      rank: wallet?.rank ?? 'STARGAZER',
      premium: false,
      equipped: toEquippedSlotsMap(equippedCosmetics),
    };

    const { canView, relationFields } = await this.resolveViewerRelation(
      viewerId,
      userId,
    );

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

  /**
   * GET /users/:userId/card — Hover mini profile (Section 8).
   * Returns 404 when the user does not exist, is not ACTIVE, or has blocked the viewer
   * (never leak reverse block).
   */
  async getHoverCard(userId: string, viewerId?: string) {
    const isOther = Boolean(viewerId) && viewerId !== userId;
    if (isOther && viewerId) {
      const blockedByTarget = await this.blocks.isBlocked(userId, viewerId);
      if (blockedByTarget) {
        throw new NotFoundException('User not found');
      }
    }

    const found = await this.prisma.user.findFirst({
      where: { id: userId, status: 'ACTIVE' },
      select: BASE_PROFILE_SELECT,
    });

    if (!found) {
      throw new NotFoundException('User not found');
    }

    const { canView, relationFields } = await this.resolveViewerRelation(
      viewerId,
      userId,
    );
    // Same rule as the profile: counts stay out of a private profile the viewer may not see.
    const followersCount = canView
      ? (await this.follows.getCounts(userId)).followers
      : null;

    const equipped = toEquippedSlotsMap(found.equippedCosmetics);

    return {
      id: found.id,
      name: found.name,
      username: found.username,
      image: found.image,
      bannerPresetId: found.bannerPresetId,
      premium: false,
      reputation: found.wallet?.reputation ?? 0,
      rank: found.wallet?.rank ?? 'STARGAZER',
      followersCount,
      isPrivate: !canView,
      ...relationFields,
      equipped: {
        frame: equipped.frame,
        miniBackground: equipped.miniBackground,
        banner: equipped.banner,
      },
    };
  }
}
