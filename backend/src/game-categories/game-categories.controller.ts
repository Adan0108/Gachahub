import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { AdminGuard } from '../common/guards/admin.guard';
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
   * Admin-only endpoint for creating a category inside a game.
   *
   * Categories are core community structure, so only admins should manage them.
   * Game moderators should manage content later, not change category structure
   * in the MVP.
   */
  @Post('games/:gameSlug/categories')
  @UseGuards(AdminGuard)
  create(
    @Param('gameSlug') gameSlug: string,
    @Body() dto: CreateGameCategoryDto,
  ) {
    return this.gameCategoriesService.create(gameSlug, dto);
  }

  /**
   * Admin-only endpoint for updating a category.
   *
   * This protects category name, slug, order, active status, and description.
   */
  @Patch('game-categories/:id')
  @UseGuards(AdminGuard)
  update(@Param('id') id: string, @Body() dto: UpdateGameCategoryDto) {
    return this.gameCategoriesService.update(id, dto);
  }
}
