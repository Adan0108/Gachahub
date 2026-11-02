import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { loadActiveUser } from '../common/guards/active-user.util';
import { GameModeratorsRepository } from '../game-moderators/game-moderators.repository';
import { PrismaService } from '../prisma/prisma.service';
import { CommunityChatRepository } from './community-chat.repository';
import { SanctionAccessService } from '../moderation-enforcement/sanction-access.service';

/** Who is asking and what they may do in this community. */
export type CommunityScope = Awaited<
  ReturnType<CommunityAccessService['scope']>
>;

/** Decides who may use a community's chat, and finds the rooms and messages that belong to it. */
@Injectable()
export class CommunityAccessService {
  constructor(
    private readonly repository: CommunityChatRepository,
    private readonly prisma: PrismaService,
    private readonly moderators: GameModeratorsRepository,
    private readonly sanctions: SanctionAccessService,
  ) {}

  /** Refuses anyone who is not an active member, moderator or admin of an active community. */
  async scope(slug: string, userId: string | undefined, write = false) {
    const user = await loadActiveUser(this.prisma, userId);
    const game = await this.repository.findGameBySlug(slug);
    if (!game || game.status !== 'ACTIVE') {
      throw new NotFoundException('Community not found');
    }
    await this.sanctions.assertAllowed(user.id, write, game.id);

    const [membership, moderator] = await Promise.all([
      this.repository.findMembership(game.id, user.id),
      this.moderators.findByGameIdAndUserId(game.id, user.id),
    ]);
    const canModerate = user.role === 'ADMIN' || moderator !== null;
    if (!membership && !canModerate) {
      throw new ForbiddenException('Join this community to use its chat');
    }

    return { user, game, membership, canModerate };
  }

  async channelIn(gameId: string, channelId: string) {
    const channel = await this.repository.findChannel(gameId, channelId);
    if (!channel) throw new NotFoundException('Channel not found');
    return channel;
  }

  async messageIn(gameId: string, messageId: string) {
    const message = await this.repository.findMessageInGame(messageId, gameId);
    if (!message) throw new NotFoundException('Message not found');
    return message;
  }
}
