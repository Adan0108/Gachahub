import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AllowAnonymous,
  OptionalAuth,
  Session,
} from '@thallesp/nestjs-better-auth';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import { QueryFeedDto, QueryGameFeedDto } from './dto/query-feed.dto';
import { FeedService } from './feed.service';

@ApiTags('Feed')
@Controller('feed')
export class FeedController {
  constructor(private readonly feedService: FeedService) {}

  @Get('latest')
  @OptionalAuth()
  @ApiOperation({
    summary: 'Get latest posts with a small social boost',
  })
  latest(
    @Query()
    query: QueryFeedDto,

    @Session()
    session?: UserSession,
  ) {
    return this.feedService.latest(query, session?.user.id);
  }

  @Get('trending')
  @AllowAnonymous()
  @ApiOperation({
    summary: 'Get global trending posts',
  })
  trending(
    @Query()
    query: QueryFeedDto,
  ) {
    return this.feedService.trending(query);
  }
}

@ApiTags('Feed')
@Controller('games')
export class GameFeedController {
  constructor(private readonly feedService: FeedService) {}

  @Get(':gameSlug/feed')
  @OptionalAuth()
  @ApiOperation({
    summary: 'Get a game community feed',
  })
  gameFeed(
    @Param('gameSlug')
    gameSlug: string,

    @Query()
    query: QueryGameFeedDto,

    @Session()
    session?: UserSession,
  ) {
    return this.feedService.gameFeed(gameSlug, query, session?.user.id);
  }
}
