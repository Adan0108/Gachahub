import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BlocksService } from '../blocks/blocks.service';
import { UsersRepository } from './users.repository';
import { UserSearchRateLimiterService } from './user-search-rate-limiter.service';
import { UsernameAvailabilityRateLimiterService } from './username-availability-rate-limiter.service';
import { SearchUsersQueryDto } from './dto/search-users-query.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { CompleteOnboardingDto } from './dto/complete-onboarding.dto';
import { ME_SELECT } from './me-select';
import { isReservedUsername } from './reserved-usernames';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly blocksService: BlocksService,
    private readonly usersRepository: UsersRepository,
    private readonly searchRateLimiter: UserSearchRateLimiterService,
    private readonly usernameAvailabilityRateLimiter: UsernameAvailabilityRateLimiterService,
  ) {}

  /**
   * Chat picker search: `@handle` is an exact handle lookup (a handle is unique, so there is
   * one answer and the unique index serves it); anything else searches display names, plus an
   * exact pasted id. Routing is on the sigil, so a display name that itself starts with "@"
   * can only be found through the handle path.
   */
  async searchForPicker(callerId: string, { q, limit }: SearchUsersQueryDto) {
    this.searchRateLimiter.assertNotRateLimited(callerId);

    if (q.startsWith('@')) {
      const match = await this.usersRepository.findPickableByUsername(
        callerId,
        q.slice(1),
      );
      return { items: match ? [match] : [] };
    }

    const byId = await this.usersRepository.findPickableById(callerId, q);
    const prefixed = await this.usersRepository.searchByName(
      callerId,
      q,
      'prefix',
      limit,
    );
    const remaining = limit - prefixed.length;
    const contained =
      remaining > 0
        ? await this.usersRepository.searchByName(
            callerId,
            q,
            'contains',
            remaining,
          )
        : [];

    const items = [...prefixed, ...contained];
    return {
      items: byId ? [byId, ...items.filter((u) => u.id !== byId.id)] : items,
    };
  }

  /**
   * A live read, not `session.user`: better-auth's secondaryStorage caches the whole
   * session+user blob from whenever it was last loaded, so a direct Prisma write (like
   * completeOnboarding below) would otherwise stay invisible here until that cache entry
   * happens to expire - the same staleness AdminGuard already works around for role/status.
   */
  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: ME_SELECT,
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  updateProfile(userId: string, dto: UpdateProfileDto) {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        messageRequestSetting: dto.messageRequestSetting,
        sendReadReceipts: dto.sendReadReceipts,
        sendLinkPreviews: dto.sendLinkPreviews,
      },
      select: ME_SELECT,
    });
  }

  /**
   * One-time claim: gated on `username IS NULL`, not `onboarded`, so a pre-existing account
   * (backfilled `onboarded: true`, never forced through the redirect gate) still has a real
   * code path to claim a handle later - `onboarded` only controls the forced redirect, not
   * whether this endpoint accepts a request. The actual guarantee is the conditional
   * `updateManyAndReturn` below (one statement, so no separate read-back), not the pre-read:
   * two concurrent calls (a double-click, a retry) both reading `username: null` would
   * otherwise both pass and the second would silently overwrite the first's claim.
   * The frontend only reaches this from /onboarding and the profile page's claim link.
   */
  async completeOnboarding(userId: string, dto: CompleteOnboardingDto) {
    if (isReservedUsername(dto.username)) {
      throw new ConflictException('That handle is reserved');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { username: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }
    if (user.username !== null) {
      throw new ConflictException('Profile already set up');
    }

    const claimed = await this.claimHandle(userId, dto);

    if (claimed.length === 0) {
      throw new ConflictException('Profile already set up');
    }

    return claimed[0];
  }

  /** The conditional write, kept apart so only the Prisma call sits inside the P2002 translation. */
  private async claimHandle(userId: string, dto: CompleteOnboardingDto) {
    try {
      return await this.prisma.user.updateManyAndReturn({
        where: { id: userId, username: null },
        data: { name: dto.name, username: dto.username, onboarded: true },
        select: ME_SELECT,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('That handle is taken');
      }

      throw error;
    }
  }

  /** Case-insensitive (citext) availability check for the onboarding form. */
  async isUsernameAvailable(
    callerId: string,
    username: string,
  ): Promise<boolean> {
    this.usernameAvailabilityRateLimiter.assertNotRateLimited(callerId);

    if (isReservedUsername(username)) {
      return false;
    }

    const existing = await this.prisma.user.findUnique({
      where: { username },
      select: { id: true },
    });

    return !existing;
  }

  /** Public profile of another user; isBlockedByMe reflects only the viewer's own block. */
  async getPublicProfile(userId: string, viewerId?: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, status: 'ACTIVE' },
      select: {
        id: true,
        name: true,
        username: true,
        image: true,
        bannerPresetId: true,
        createdAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const isBlockedByMe =
      viewerId && viewerId !== userId
        ? await this.blocksService.isBlocked(viewerId, userId)
        : false;

    return { ...user, isBlockedByMe };
  }
}
