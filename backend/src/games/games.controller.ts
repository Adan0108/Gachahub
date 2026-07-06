import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Session } from '@thallesp/nestjs-better-auth';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import type { auth } from '../auth/auth';
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
   * Protected endpoint for creating a game.
   *
   * Current behavior:
   * - Any logged-in user can create a game while the project is in early stage
   *
   * Future behavior:
   * - Restrict this route to ADMIN only using a RolesGuard
   */
  @Post()
  create(
    @Body() dto: CreateGameDto,
    @Session() session: UserSession<typeof auth>,
  ) {
    return this.gamesService.create(dto, session.user.id);
  }

  /**
   * Protected endpoint for updating a game.
   *
   * Current behavior:
   * - Any logged-in user can update during early development
   *
   * Future behavior:
   * - Restrict this route to ADMIN only
   */
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateGameDto) {
    return this.gamesService.update(id, dto);
  }
}
