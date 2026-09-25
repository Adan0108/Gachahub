import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BlocksService } from '../blocks/blocks.service';
import { UsersRepository } from './users.repository';
import { UserSearchRateLimiterService } from './user-search-rate-limiter.service';
import { SearchUsersQueryDto } from './dto/search-users-query.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';

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

  updateProfile(userId: string, dto: UpdateProfileDto) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { messageRequestSetting: dto.messageRequestSetting },
    });
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
