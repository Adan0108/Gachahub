import { Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OptionalAuth, Session } from '@thallesp/nestjs-better-auth';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import { ListFollowsQueryDto } from './dto/list-follows-query.dto';
import { FollowsService } from './follows.service';

@ApiTags('Follows')
@Controller('users')
export class FollowsController {
  constructor(private readonly followsService: FollowsService) {}

  @Post(':userId/follow')
  @ApiCookieAuth('better-auth.session_token')
  @ApiOperation({
    summary: 'Follow a user',
  })
  follow(@Param('userId') userId: string, @Session() session: UserSession) {
    return this.followsService.follow(session.user.id, userId);
  }

  @Delete(':userId/follow')
  @ApiCookieAuth('better-auth.session_token')
  @ApiOperation({
    summary: 'Unfollow a user',
  })
  unfollow(@Param('userId') userId: string, @Session() session: UserSession) {
    return this.followsService.unfollow(session.user.id, userId);
  }

  @Get(':userId/followers')
  @OptionalAuth()
  @ApiOperation({ summary: "A user's followers, newest first" })
  followers(
    @Param('userId') userId: string,
    @Query() query: ListFollowsQueryDto,
    @Session() session?: UserSession,
  ) {
    return this.followsService.listFollowers(userId, session?.user.id, query);
  }

  @Get(':userId/following')
  @OptionalAuth()
  @ApiOperation({ summary: 'The people a user follows, newest first' })
  following(
    @Param('userId') userId: string,
    @Query() query: ListFollowsQueryDto,
    @Session() session?: UserSession,
  ) {
    return this.followsService.listFollowing(userId, session?.user.id, query);
  }

  @Get(':userId/follow-status')
  @ApiCookieAuth('better-auth.session_token')
  @ApiOperation({
    summary:
      'Check whether the current user and another user follow each other',
  })
  followStatus(
    @Param('userId') userId: string,
    @Session() session: UserSession,
  ) {
    return this.followsService.getFollowStatus(session.user.id, userId);
  }
}
