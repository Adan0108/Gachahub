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
import { SearchUsersQueryDto } from './dto/search-users-query.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { CompleteOnboardingDto } from './dto/complete-onboarding.dto';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly blocksService: BlocksService,
    private readonly usersRepository: UsersRepository,
    private readonly searchRateLimiter: UserSearchRateLimiterService,
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
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

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

  /** One-time claim: sets name + username and flips onboarded, only while it's still false. */
  async completeOnboarding(userId: string, dto: CompleteOnboardingDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { onboarded: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }
    if (user.onboarded) {
      throw new ConflictException('Profile already set up');
    }

    try {
      return await this.prisma.user.update({
        where: { id: userId },
        data: { name: dto.name, username: dto.username, onboarded: true },
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
  async isUsernameAvailable(username: string): Promise<boolean> {
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
