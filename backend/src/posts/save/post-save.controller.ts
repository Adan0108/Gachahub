import { Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiTags,
  ApiOperation,
  ApiParam,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiBadRequestResponse,
} from '@nestjs/swagger';
import { Session } from '@thallesp/nestjs-better-auth';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import { PostSaveService } from './post-save.service';
import { QuerySavedPostsDto } from './dto/query-saved-posts.dto';

@ApiTags('Posts')
@ApiCookieAuth('better-auth.session_token')
@ApiUnauthorizedResponse({
  description:
    'Missing or invalid session, or session account no longer exists',
})
@ApiForbiddenResponse({ description: 'User account is not active' })
@Controller('posts')
export class PostSaveController {
  constructor(private readonly postSaveService: PostSaveService) {}

  // PostsModule registers this controller before PostsController's :id route.
  @Get('saved')
  @ApiOperation({
    summary: 'List your saved posts that are currently viewable',
  })
  @ApiBadRequestResponse({ description: 'Invalid pagination query or cursor' })
  @ApiOkResponse({
    schema: {
      type: 'object',
      required: ['items', 'hasMore', 'nextCursor'],
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            description:
              'Standard post response with its save timestamp; raw like/save relations are omitted',
            required: ['savedAt', 'savedByCurrentUser', 'likedByCurrentUser'],
            properties: {
              savedAt: { type: 'string', format: 'date-time' },
              savedByCurrentUser: { type: 'boolean' },
              likedByCurrentUser: { type: 'boolean' },
            },
            additionalProperties: true,
          },
        },
        hasMore: { type: 'boolean' },
        nextCursor: {
          type: 'string',
          nullable: true,
          description: 'Opaque continuation cursor, or null on the last page',
        },
      },
    },
  })
  list(@Session() session: UserSession, @Query() query: QuerySavedPostsDto) {
    return this.postSaveService.list(session.user.id, query);
  }

  @Post(':id/save')
  @ApiOperation({ summary: 'Save a viewable post for the current user' })
  @ApiParam({ name: 'id', description: 'Post ID', example: 'cm123abc456' })
  @ApiCreatedResponse({
    schema: {
      type: 'object',
      required: ['saved'],
      properties: { saved: { type: 'boolean', enum: [true] } },
    },
  })
  @ApiNotFoundResponse({
    description: 'Post not found or not viewable by the current user',
  })
  save(@Session() session: UserSession, @Param('id') id: string) {
    return this.postSaveService.save(session.user.id, id);
  }

  @Delete(':id/save')
  @ApiOperation({
    summary: 'Remove your save, even if the post is no longer viewable',
  })
  @ApiParam({ name: 'id', description: 'Post ID', example: 'cm123abc456' })
  @ApiOkResponse({
    schema: {
      type: 'object',
      required: ['saved'],
      properties: { saved: { type: 'boolean', enum: [false] } },
    },
  })
  unsave(@Session() session: UserSession, @Param('id') id: string) {
    return this.postSaveService.unsave(session.user.id, id);
  }
}
