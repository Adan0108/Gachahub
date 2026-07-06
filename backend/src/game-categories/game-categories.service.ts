import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { slugify } from '../common/utils/slugify';
import { GamesRepository } from '../games/games.repository';
import { CreateGameCategoryDto } from './dto/create-game-category.dto';
import { QueryGameCategoriesDto } from './dto/query-game-categories.dto';
import { UpdateGameCategoryDto } from './dto/update-game-category.dto';
import { GameCategoriesRepository } from './game-categories.repository';

/**
 * Service responsible for game category business logic.
 *
 * A category always belongs to a game.
 * Example:
 * Wuthering Waves → Guide
 * Wuthering Waves → Lore
 * Honkai Star Rail → Build
 */
@Injectable()
export class GameCategoriesService {
  constructor(
    private readonly gameCategoriesRepository: GameCategoriesRepository,
    private readonly gamesRepository: GamesRepository,
  ) {}

  /**
   * Lists categories for a game by game slug.
   *
   * Business behavior:
   * - First checks the game exists
   * - Then returns categories for that game
   * - Optional isActive filter is supported
   */
  async findByGameSlug(gameSlug: string, query: QueryGameCategoriesDto) {
    const game = await this.gamesRepository.findBySlug(gameSlug);

    if (!game) {
      throw new NotFoundException('Game not found');
    }

    return this.gameCategoriesRepository.findManyByGameId(game.id, {
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
    });
  }

  /**
   * Creates a category inside a game.
   *
   * Business behavior:
   * - Finds the game by slug
   * - Generates slug from name when slug is not provided
   * - Prevents duplicate category slug inside the same game
   */
  async create(gameSlug: string, dto: CreateGameCategoryDto) {
    const game = await this.gamesRepository.findBySlug(gameSlug);

    if (!game) {
      throw new NotFoundException('Game not found');
    }

    const slug = dto.slug ? slugify(dto.slug) : slugify(dto.name);

    const existingCategory =
      await this.gameCategoriesRepository.findByGameIdAndSlug(game.id, slug);

    if (existingCategory) {
      throw new ConflictException('Category slug already exists in this game');
    }

    return this.gameCategoriesRepository.create({
      game: {
        connect: {
          id: game.id,
        },
      },
      name: dto.name,
      slug,
      description: dto.description,
      icon: dto.icon,
      sortOrder: dto.sortOrder,
      isActive: dto.isActive,
    });
  }

  /**
   * Updates an existing game category.
   *
   * Business behavior:
   * - Checks the category exists
   * - If slug changes, prevents duplicate slug in the same game
   * - Updates only submitted fields
   */
  async update(id: string, dto: UpdateGameCategoryDto) {
    const category = await this.gameCategoriesRepository.findById(id);

    if (!category) {
      throw new NotFoundException('Game category not found');
    }

    const nextSlug = dto.slug ? slugify(dto.slug) : undefined;

    if (nextSlug && nextSlug !== category.slug) {
      const existingCategory =
        await this.gameCategoriesRepository.findByGameIdAndSlug(
          category.gameId,
          nextSlug,
        );

      if (existingCategory) {
        throw new ConflictException(
          'Category slug already exists in this game',
        );
      }
    }

    return this.gameCategoriesRepository.update(id, {
      name: dto.name,
      slug: nextSlug,
      description: dto.description,
      icon: dto.icon,
      sortOrder: dto.sortOrder,
      isActive: dto.isActive,
    });
  }
}
