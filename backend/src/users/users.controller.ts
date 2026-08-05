import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Session } from '@thallesp/nestjs-better-auth';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { Public } from '../common/decorators/public.decorator';
import { PostsService } from '../posts/posts.service';

@ApiTags('Users')
@ApiCookieAuth('better-auth.session_token')
@Controller('users')
export class UsersController {
  constructor(private readonly postsService: PostsService) {}

  @Get('me')
  @ApiOperation({ summary: 'Get current authenticated user' })
  getMe(@Session() session: UserSession) {
    return session.user;
  }

  @Get(':userId/posts')
  @Public()
  @ApiOperation({ summary: 'Get public posts from this user' })
  findUserPosts(
    @Param('userId') userId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.postsService.findByAuthorPublic(query, userId);
  }
}
