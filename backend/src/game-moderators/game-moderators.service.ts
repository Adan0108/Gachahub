import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UserRole } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { loadActiveUser } from '../common/guards/active-user.util';
import { AssignGameModeratorDto } from './dto/assign-game-moderator.dto';
import { GameModeratorsRepository } from './game-moderators.repository';

/**
 * Service responsible for game moderator business logic.
 *
 * Admins use this service to:
 * - assign a user as a game moderator
 * - list moderators of a game
 * - remove a moderator from a game
 *
 * Game moderators are scoped to one game.
 * They are not platform-level admins.
 */
@Injectable()
export class GameModeratorsService {
  constructor(
    private readonly gameModeratorsRepository: GameModeratorsRepository,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Lists all moderators assigned to a game.
   *
   * Business behavior:
   * - Find the game by slug.
   * - Throw 404 if the game does not exist.
   * - Return all moderator assignments for that game.
   */
  async findByGameSlug(gameSlug: string) {
    const game = await this.gameModeratorsRepository.findGameBySlug(gameSlug);

    if (!game) {
      throw new NotFoundException('Game not found');
    }

    return this.gameModeratorsRepository.findManyByGameId(game.id);
  }

  /**
   * Check if a user moderates a game, by id. Private - assertCanModerateGame
   * is the only caller now that chat delegates to it instead of calling this
   * directly.
   */
  private async isModerator(gameId: string, userId: string): Promise<boolean> {
    const moderator = await this.gameModeratorsRepository.findByGameIdAndUserId(
      gameId,
      userId,
    );

    return moderator !== null;
  }

  /**
   * Asserts the user can moderate the given game: either an ADMIN, or an
   * assigned moderator of that game. Shared so callers outside chat (posts,
   * comments) don't each duplicate the same admin-or-moderator check.
   *
   * Delegates the "does this account exist and is it ACTIVE" gate to
   * loadActiveUser - the same function AdminGuard uses - rather than
   * re-checking it here, so a caller invoking this with no guard in front
   * of it (or a banned account whose session predates the ban) is rejected
   * the same way, with the same 401-vs-403 split, everywhere in the app.
   */
  async assertCanModerateGame(gameId: string, userId: string): Promise<void> {
    const user = await loadActiveUser(this.prisma, userId);

    if (user.role === UserRole.ADMIN) {
      return;
    }

    const isModerator = await this.isModerator(gameId, userId);

    if (!isModerator) {
      throw new ForbiddenException('You cannot moderate this game');
    }
  }

  /**
   * Resolves a game slug (as it appears in moderation routes) to its id, so
   * callers can compare it against a resource's own gameId - e.g. checking
   * a post actually belongs to the game named in the route.
   */
  async resolveGameId(gameSlug: string): Promise<string> {
    const game = await this.gameModeratorsRepository.findGameBySlug(gameSlug);

    if (!game) {
      throw new NotFoundException('Game not found');
    }

    return game.id;
  }

  /**
   * Resolves the route's gameSlug and confirms the caller can moderate that
   * game, in that order, returning the game's id. The entry point for any
   * moderator action that doesn't target one specific resource (listings).
   */
  async resolveModeratableGameId(
    gameSlug: string,
    moderatorId: string,
  ): Promise<string> {
    const gameId = await this.resolveGameId(gameSlug);
    await this.assertCanModerateGame(gameId, moderatorId);

    return gameId;
  }

  /**
   * The shared preamble for every moderation action on one game-scoped
   * resource (a post, a report, ...): resolve the route's game -> authorize
   * the caller for it -> load the resource -> cross-check it really belongs
   * to that game.
   *
   * The order is the point. Authorizing before loading means a non-moderator
   * always gets 403 whether or not the resource exists; loading first would
   * let anyone with a session tell "exists in this game" (403) from "doesn't"
   * (404) before they're allowed to know either. Callers supply only how to
   * load their resource (return null for anything that shouldn't be
   * moderatable, e.g. soft-deleted), so no caller can reorder these steps.
   */
  async loadModeratableResource<T extends { gameId: string }>(params: {
    gameSlug: string;
    moderatorId: string;
    notFoundMessage: string;
    load: () => Promise<T | null>;
  }): Promise<{ gameId: string; resource: T }> {
    const gameId = await this.resolveModeratableGameId(
      params.gameSlug,
      params.moderatorId,
    );

    const resource = await params.load();

    if (!resource || resource.gameId !== gameId) {
      throw new NotFoundException(params.notFoundMessage);
    }

    return { gameId, resource };
  }

  /**
   * Assigns a user as moderator of a game.
   *
   * Business behavior:
   * - Find the game by slug.
   * - Find the target user by userId or email.
   * - Block inactive/banned/deleted users.
   * - Prevent duplicate moderator assignment.
   * - Store who assigned the moderator.
   *
   * @param gameSlug The game slug from the route.
   * @param dto The user target, by userId or email.
   * @param assignedBy The admin user id who performs the assignment.
   */
  async assignModerator(
    gameSlug: string,
    dto: AssignGameModeratorDto,
    assignedBy: string,
  ) {
    if (!dto.userId && !dto.email) {
      throw new BadRequestException('userId or email is required');
    }

    const game = await this.gameModeratorsRepository.findGameBySlug(gameSlug);

    if (!game) {
      throw new NotFoundException('Game not found');
    }

    const user = dto.userId
      ? await this.gameModeratorsRepository.findUserById(dto.userId)
      : await this.gameModeratorsRepository.findUserByEmail(dto.email!);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.status !== 'ACTIVE') {
      throw new BadRequestException('Only active users can be moderators');
    }

    const existingModerator =
      await this.gameModeratorsRepository.findByGameIdAndUserId(
        game.id,
        user.id,
      );

    if (existingModerator) {
      throw new ConflictException('User is already a moderator of this game');
    }

    return this.gameModeratorsRepository.create({
      game: {
        connect: {
          id: game.id,
        },
      },
      user: {
        connect: {
          id: user.id,
        },
      },
      assigner: {
        connect: {
          id: assignedBy,
        },
      },
    });
  }

  /**
   * Removes a user from the moderator list of a game.
   *
   * Business behavior:
   * - Find the game by slug.
   * - Check the moderator assignment exists.
   * - Delete the assignment.
   */
  async removeModerator(gameSlug: string, userId: string) {
    const game = await this.gameModeratorsRepository.findGameBySlug(gameSlug);

    if (!game) {
      throw new NotFoundException('Game not found');
    }

    const existingModerator =
      await this.gameModeratorsRepository.findByGameIdAndUserId(
        game.id,
        userId,
      );

    if (!existingModerator) {
      throw new NotFoundException('Moderator assignment not found');
    }

    await this.gameModeratorsRepository.deleteByGameIdAndUserId(
      game.id,
      userId,
    );

    return {
      message: 'Moderator removed successfully',
    };
  }
}
