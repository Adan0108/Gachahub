import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BlocksService } from '../blocks/blocks.service';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly blocksService: BlocksService,
  ) {}

  updateProfile(userId: string, dto: UpdateProfileDto) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { messageRequestSetting: dto.messageRequestSetting },
    });
  }

  /**
   * Public profile for viewing another user, e.g. clicking their name in a
   * group chat. isBlockedByMe only reflects the viewer's own block, never
   * whether the target has blocked the viewer back - same guiding principle
   * as chat's participant flags (never leak the reverse direction).
   */
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
