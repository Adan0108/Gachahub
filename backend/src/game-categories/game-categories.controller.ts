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
import {
  ApiCookieAuth,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
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
@ApiTags('Game Categories')
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
  @ApiOperation({ summary: 'List categories for a game' })
  @ApiParam({
    name: 'gameSlug',
    example: 'wuthering-waves',
  })
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
  @ApiCookieAuth('better-auth.session_token')
  @ApiOperation({ summary: 'Create a game category. Admin only.' })
  @ApiParam({
    name: 'gameSlug',
    example: 'wuthering-waves',
  })
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
  @ApiCookieAuth('better-auth.session_token')
  @ApiOperation({ summary: 'Update a game category. Admin only.' })
  @ApiParam({
    name: 'id',
    example: 'cm123abc456',
  })
  update(@Param('id') id: string, @Body() dto: UpdateGameCategoryDto) {
    return this.gameCategoriesService.update(id, dto);
  }
}
