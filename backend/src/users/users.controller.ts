import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Session, OptionalAuth } from '@thallesp/nestjs-better-auth';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { PostsService } from '../posts/posts.service';
import { UsersService } from './users.service';
import { SearchUsersQueryDto } from './dto/search-users-query.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';

@ApiTags('Users')
@Controller('users')
export class UsersController {
  constructor(
    private readonly postsService: PostsService,
    private readonly usersService: UsersService,
  ) {}

  @Get('me')
  @ApiCookieAuth('better-auth.session_token')
  @ApiOperation({ summary: 'Get current authenticated user' })
  getMe(@Session() session: UserSession) {
    return session.user;
  }

  @Patch('me')
  @ApiCookieAuth('better-auth.session_token')
  @ApiOperation({ summary: 'Update current authenticated user profile' })
  updateMe(@Session() session: UserSession, @Body() dto: UpdateProfileDto) {
    return this.usersService.updateProfile(session.user.id, dto);
  }

  // Must stay above ':userId' or it is read as a user id.
  @Get('search')
  @ApiCookieAuth('better-auth.session_token')
  @ApiOperation({ summary: 'Search active users by display name' })
  search(@Session() session: UserSession, @Query() query: SearchUsersQueryDto) {
    return this.usersService.searchForPicker(session.user.id, query);
  }

  @Get(':userId/posts')
  @OptionalAuth()
  @ApiOperation({ summary: 'Get public posts from this user' })
  findUserPosts(
    @Param('userId') userId: string,
    @Query() query: PaginationQueryDto,
    @Session() session?: UserSession,
  ) {
    return this.postsService.findByAuthorPublic(
      query,
      userId,
      session?.user.id,
    );
  }

  @Get(':userId')
  @OptionalAuth()
  @ApiOperation({ summary: "Get a user's public profile" })
  getUserProfile(
    @Param('userId') userId: string,
    @Session() session?: UserSession,
  ) {
    return this.usersService.getPublicProfile(userId, session?.user.id);
  }
}
