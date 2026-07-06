import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { CreateGameCategoryDto } from './dto/create-game-category.dto';
import { QueryGameCategoriesDto } from './dto/query-game-categories.dto';
import { UpdateGameCategoryDto } from './dto/update-game-category.dto';
import { GameCategoriesService } from './game-categories.service';

/**
 * Controller responsible for game category HTTP routes.
 *
 * Categories belong to games, so public listing and creation routes
 * are nested under /games/:gameSlug/categories.
 */
@Controller()
export class GameCategoriesController {
  constructor(private readonly gameCategoriesService: GameCategoriesService) {}

  /**
   * Public endpoint for listing categories of a specific game.
   *
   * Example:
   * GET /games/wuthering-waves/categories
   */
  @Get('games/:gameSlug/categories')
  @Public()
  findByGameSlug(
    @Param('gameSlug') gameSlug: string,
    @Query() query: QueryGameCategoriesDto,
  ) {
    return this.gameCategoriesService.findByGameSlug(gameSlug, query);
  }

  /**
   * Protected endpoint for creating a category inside a game.
   *
   * Current behavior:
   * - Any logged-in user can create during early development
   *
   * Future behavior:
   * - Restrict this route to ADMIN or game moderator.
   */
  @Post('games/:gameSlug/categories')
  create(
    @Param('gameSlug') gameSlug: string,
    @Body() dto: CreateGameCategoryDto,
  ) {
    return this.gameCategoriesService.create(gameSlug, dto);
  }

  /**
   * Protected endpoint for updating a category.
   *
   * Current behavior:
   * - Any logged-in user can update during early development
   *
   * Future behavior:
   * - Restrict this route to ADMIN or game moderator.
   */
  @Patch('game-categories/:id')
  update(@Param('id') id: string, @Body() dto: UpdateGameCategoryDto) {
    return this.gameCategoriesService.update(id, dto);
  }
}
