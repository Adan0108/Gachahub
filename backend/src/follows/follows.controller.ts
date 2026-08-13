import { Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Session } from '@thallesp/nestjs-better-auth';
import type { UserSession } from '@thallesp/nestjs-better-auth';
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

  @Get(':userId/follow-status')
  @ApiCookieAuth('better-auth.session_token')
  @ApiOperation({
    summary: 'Check whether the current user follows another user',
  })
  followStatus(
    @Param('userId') userId: string,
    @Session() session: UserSession,
  ) {
    return this.followsService.isFollowing(session.user.id, userId);
  }
}
