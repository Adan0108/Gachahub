import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { loadActiveUser } from '../common/guards/active-user.util';
import { formatGame } from './game.mapper';
import { GameMembershipRepository } from './game-membership.repository';

/** Owns ordinary community membership; GameModerator remains the permission source. */
@Injectable()
export class GameMembershipService {
  constructor(
    private readonly repository: GameMembershipRepository,
    private readonly prisma: PrismaService,
  ) {}

  /** Requires an active session user, then resolves the requested community. */
  private async resolve(slug: string, userId: string | undefined) {
    const user = await loadActiveUser(this.prisma, userId);
    const game = await this.repository.findGameBySlug(slug);
    if (!game) throw new NotFoundException('Game not found');
    return { game, userId: user.id };
  }

  /** Joins a reachable game without accepting a client-selected identity or role. */
  async join(slug: string, userId: string | undefined) {
    const scope = await this.resolve(slug, userId);
    if (scope.game.status === 'ARCHIVED')
      throw new NotFoundException('Game not found');
    return this.repository.join(scope.game.id, scope.userId);
  }

  /** Allows users to leave even an archived community. */
  async leave(slug: string, userId: string | undefined) {
    const scope = await this.resolve(slug, userId);
    return this.repository.leave(scope.game.id, scope.userId);
  }

  /** Reads the current user's membership without exposing its internal fields. */
  async status(slug: string, userId: string | undefined) {
    const scope = await this.resolve(slug, userId);
    return this.repository.status(scope.game.id, scope.userId);
  }

  /** Returns game responses using the existing public game mapper. */
  async list(userId: string | undefined) {
    const user = await loadActiveUser(this.prisma, userId);
    const games = await this.repository.list(user.id);
    return { items: games.map(formatGame) };
  }
}
