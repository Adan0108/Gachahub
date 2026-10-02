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
import { isReservedUsername } from './reserved-usernames';

/** Every field `session.user` used to expose - see getMe's own docblock for why this is a live read instead. */
const ME_SELECT = {
  id: true,
  name: true,
  email: true,
  emailVerified: true,
  image: true,
  createdAt: true,
  updatedAt: true,
  role: true,
  status: true,
  messageRequestSetting: true,
  username: true,
  onboarded: true,
} as const;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly blocksService: BlocksService,
    private readonly usersRepository: UsersRepository,
    private readonly searchRateLimiter: UserSearchRateLimiterService,
    private readonly usernameAvailabilityRateLimiter: UsernameAvailabilityRateLimiterService,
  ) {}

  /** Name search for the chat picker: prefix matches first, then the rest that merely contain q. */
  async searchForPicker(callerId: string, { q, limit }: SearchUsersQueryDto) {
    this.searchRateLimiter.assertNotRateLimited(callerId);

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
      data: { messageRequestSetting: dto.messageRequestSetting },
    });
  }

  /**
   * One-time claim: gated on `username IS NULL`, not `onboarded`, so a pre-existing account
   * (backfilled `onboarded: true`, never forced through the redirect gate) still has a real
   * code path to claim a handle later - `onboarded` only controls the forced redirect, not
   * whether this endpoint accepts a request. The actual guarantee is the conditional
   * `updateMany` below, not the pre-read: two concurrent calls (a double-click, a retry) both
   * reading `username: null` would otherwise both pass and the second would silently
   * overwrite the first's claim.
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

    try {
      const claimed = await this.prisma.user.updateMany({
        where: { id: userId, username: null },
        data: { name: dto.name, username: dto.username, onboarded: true },
      });

      if (claimed.count === 0) {
        throw new ConflictException('Profile already set up');
      }

      return await this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
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
