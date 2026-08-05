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
import { AllowAnonymous, Session } from '@thallesp/nestjs-better-auth';
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
  @AllowAnonymous()
  @ApiOperation({
    summary: 'List published public posts',
  })
  findAll(@Query() query: QueryPostsDto) {
    return this.postsService.findAll(query);
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
    return this.postsService.findByAuthor(query, session.user.id);
  }

  @Get(':id')
  @AllowAnonymous()
  @ApiOperation({
    summary: 'Get a published public post by ID',
  })
  @ApiParam({
    name: 'id',
    example: 'cm123abc456',
  })
  findOne(@Param('id') id: string) {
    return this.postsService.findOne(id);
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
}
