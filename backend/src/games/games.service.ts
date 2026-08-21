import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import { slugify } from '../common/utils/slugify';
import { CreateGameDto } from './dto/create-game.dto';
import { QueryGamesDto } from './dto/query-games.dto';
import { UpdateGameDto } from './dto/update-game.dto';
import { GamesRepository } from './games.repository';

/**
 * Service responsible for game business logic.
 *
 * This layer decides what should happen.
 * It should not directly expose Prisma query details to the controller.
 */
@Injectable()
export class GamesService {
  constructor(private readonly gamesRepository: GamesRepository) {}

  /**
   * Lists games with optional search, status filter, and pagination.
   *
   * Business behavior:
   * - Defaults to page 1 and limit 20
   * - Orders games by newest first
   * - Supports basic search by name and slug
   */
  async findAll(query: QueryGamesDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Prisma.GameWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              {
                name: {
                  contains: query.search,
                  mode: 'insensitive',
                },
              },
              {
                slug: {
                  contains: query.search,
                  mode: 'insensitive',
                },
              },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.gamesRepository.findMany({
        where,
        skip,
        take: limit,
        orderBy: {
          createdAt: 'desc',
        },
      }),
      this.gamesRepository.count(where),
    ]);

    return {
      items,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Finds one game by slug.
   *
   * This is useful for pages like:
   * /games/wuthering-waves
   *
   * Throws NotFoundException if the slug does not exist.
   *
   * Consistent with findById - should return null too instead of throwing for caller
   * but out of scope for this... so comment will do.
   */
  async findBySlug(slug: string) {
    const game = await this.gamesRepository.findBySlug(slug);

    if (!game) {
      throw new NotFoundException('Game not found');
    }

    return game;
  }

  /**
   * Find one game by id, null if missing
   * logic for caller on handling missing game.
   */
  async findById(id: string) {
    return this.gamesRepository.findById(id);
  }

  /**
   * Creates a new game community.
   *
   * Business behavior:
   * - If slug is not provided, generate it from the game name
   * - Prevent duplicate slug
   * - Store the user id of the creator when available
   *
   * Later this route should become admin-only.
   */
  async create(dto: CreateGameDto, createdBy?: string) {
    const slug = dto.slug ? slugify(dto.slug) : slugify(dto.name);

    const existingGame = await this.gamesRepository.findBySlug(slug);

    if (existingGame) {
      throw new ConflictException('Game slug already exists');
    }

    return this.gamesRepository.create({
      name: dto.name,
      slug,
      description: dto.description,
      iconUrl: dto.iconUrl,
      bannerUrl: dto.bannerUrl,
      developer: dto.developer,
      publisher: dto.publisher,
      createdBy,
    });
  }

  /**
   * Updates an existing game.
   *
   * Business behavior:
   * - Checks that the game exists
   * - If slug changes, check duplicate slug before update
   * - Keeps update logic centralized in the service
   *
   * Later this route should become admin-only.
   */
  async update(id: string, dto: UpdateGameDto) {
    const game = await this.gamesRepository.findById(id);

    if (!game) {
      throw new NotFoundException('Game not found');
    }

    const nextSlug = dto.slug ? slugify(dto.slug) : undefined;

    if (nextSlug && nextSlug !== game.slug) {
      const existingGame = await this.gamesRepository.findBySlug(nextSlug);

      if (existingGame) {
        throw new ConflictException('Game slug already exists');
      }
    }

    return this.gamesRepository.update(id, {
      name: dto.name,
      slug: nextSlug,
      description: dto.description,
      iconUrl: dto.iconUrl,
      bannerUrl: dto.bannerUrl,
      developer: dto.developer,
      publisher: dto.publisher,
      status: dto.status,
    });
  }
}
