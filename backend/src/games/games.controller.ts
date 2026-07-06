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
import { Session } from '@thallesp/nestjs-better-auth';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import { AdminGuard } from '../common/guards/admin.guard';
import { Public } from '../common/decorators/public.decorator';
import { CreateGameDto } from './dto/create-game.dto';
import { QueryGamesDto } from './dto/query-games.dto';
import { UpdateGameDto } from './dto/update-game.dto';
import { GamesService } from './games.service';

/**
 * Controller responsible for game HTTP routes.
 *
 * Controller responsibility:
 * - Receive route params, query, and body
 * - Call the service
 * - Do not contain business logic
 */
@Controller('games')
export class GamesController {
  constructor(private readonly gamesService: GamesService) {}

  /**
   * Public endpoint for listing all games.
   *
   * This is public because users should be able to browse game communities
   * before logging in.
   *
   * Example:
   * GET /games
   * GET /games?search=wuwa
   */
  @Get()
  @Public()
  findAll(@Query() query: QueryGamesDto) {
    return this.gamesService.findAll(query);
  }

  /**
   * Public endpoint for viewing a single game by slug.
   *
   * Example:
   * GET /games/wuthering-waves
   */
  @Get(':slug')
  @Public()
  findBySlug(@Param('slug') slug: string) {
    return this.gamesService.findBySlug(slug);
  }

  /**
   * Admin-only endpoint for creating a game.
   *
   * Only platform admins should create official game communities.
   * Normal users should not be able to create games because games are
   * top-level system data used by posts, categories, moderators, builds,
   * teams, and reports.
   */
  @Post()
  @UseGuards(AdminGuard)
  create(@Body() dto: CreateGameDto, @Session() session: UserSession) {
    return this.gamesService.create(dto, session.user.id);
  }
  /**
   * Admin-only endpoint for updating a game.
   *
   * This protects important game metadata such as name, slug, banner,
   * icon, developer, publisher, and status.
   */
  @Patch(':id')
  @UseGuards(AdminGuard)
  update(@Param('id') id: string, @Body() dto: UpdateGameDto) {
    return this.gamesService.update(id, dto);
  }
}
