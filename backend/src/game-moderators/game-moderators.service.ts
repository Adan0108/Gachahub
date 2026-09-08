import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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
   * Check if a user moderates a game, by id.
   */

  async isModerator(gameId: string, userId: string): Promise<boolean> {
    const moderator = await this.gameModeratorsRepository.findByGameIdAndUserId(
      gameId,
      userId,
    );

    return moderator !== null;
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
