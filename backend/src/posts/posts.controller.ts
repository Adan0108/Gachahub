import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { OptionalAuth, Session } from '@thallesp/nestjs-better-auth';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import { CreatePostDto } from './dto/create-post.dto';
import { QueryPostsDto } from './dto/query-posts.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { PostsService } from './posts.service';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';

@ApiTags('Posts')
@Controller('posts')
export class PostsController {
  constructor(private readonly postsService: PostsService) {}

  @Get()
  @OptionalAuth()
  @ApiOperation({
    summary: 'List published public posts',
  })
  findAll(@Query() query: QueryPostsDto, @Session() session?: UserSession) {
    return this.postsService.findAll(query, session?.user.id);
  }

  @Get('mine')
  @ApiCookieAuth('better-auth.session_token')
  @ApiOperation({
    summary: 'Find all posts owned by current user',
  })
  findMyPosts(
    @Query() query: PaginationQueryDto,
    @Session() session: UserSession,
  ) {
    return this.postsService.findByAuthor(
      query,
      session.user.id, // authorId
      session.user.id, // current user → hydrate postLikes
    );
  }

  @Get(':id')
  @OptionalAuth()
  @ApiOperation({
    summary: 'Get a published public post by ID',
  })
  @ApiParam({
    name: 'id',
    example: 'cm123abc456',
  })
  findOne(@Param('id') id: string, @Session() session?: UserSession) {
    return this.postsService.findOne(id, session?.user.id);
  }

  @Post()
  @ApiCookieAuth('better-auth.session_token')
  @ApiOperation({
    summary: 'Create a post',
  })
  create(@Body() dto: CreatePostDto, @Session() session: UserSession) {
    return this.postsService.create(dto, session.user.id);
  }

  @Patch(':id')
  @ApiCookieAuth('better-auth.session_token')
  @ApiOperation({
    summary: 'Update your own post',
  })
  @ApiParam({
    name: 'id',
    example: 'cm123abc456',
  })
  update(
    @Param('id') id: string,
    @Body() dto: UpdatePostDto,
    @Session() session: UserSession,
  ) {
    return this.postsService.update(id, dto, session.user.id);
  }

  @Delete(':id')
  @ApiCookieAuth('better-auth.session_token')
  @ApiOperation({
    summary: 'Soft-delete your own post',
  })
  @ApiParam({
    name: 'id',
    example: 'cm123abc456',
  })
  remove(@Param('id') id: string, @Session() session: UserSession) {
    return this.postsService.remove(id, session.user.id);
  }

  @Post(':id/like')
  @ApiCookieAuth('better-auth.session_token')
  @ApiOperation({
    summary: 'Like a post',
  })
  @ApiParam({
    name: 'id',
    example: 'cmubqwequ123',
  })
  like(@Param('id') id: string, @Session() session: UserSession) {
    return this.postsService.like(id, session.user.id);
  }

  @Delete(':id/like')
  @ApiCookieAuth('better-auth.session_token')
  @ApiOperation({
    summary: 'Unlike a post',
  })
  @ApiParam({
    name: 'id',
    example: 'cmubqwequ123',
  })
  unlike(@Param('id') id: string, @Session() session: UserSession) {
    return this.postsService.unlike(id, session.user.id);
  }
}
