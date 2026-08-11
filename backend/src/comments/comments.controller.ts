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
import { Session } from '@thallesp/nestjs-better-auth';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { CommentsService } from './comments.service';
import { CreateCommentDto } from './dto/create-comment.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';
import { Public } from '../common/decorators/public.decorator';

@ApiTags('Comments')
@Controller()
export class CommentsController {
  constructor(private readonly commentsService: CommentsService) {}

  @Get('posts/:postId/comments')
  @Public()
  @ApiOperation({
    summary: 'List all comments for a post',
  })
  @ApiParam({
    name: 'postId',
    example: 'cm123avi123',
  })
  findByPost(
    @Param('postId') postId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.commentsService.findByPost(postId, query);
  }

  @Post('posts/:postId/comments')
  @ApiCookieAuth('better-auth.session_token')
  @ApiOperation({
    summary: 'Create a comment on a post',
  })
  @ApiParam({
    name: 'postId',
    example: 'cm123acs123',
  })
  create(
    @Param('postId') postId: string,
    @Body() dto: CreateCommentDto,
    @Session() session: UserSession,
  ) {
    return this.commentsService.create(postId, dto, session.user.id);
  }

  @Get('comments/:commentId/replies')
  @ApiCookieAuth('better-auth.session_token')
  @ApiOperation({
    summary: 'List all replies to a comment',
  })
  @ApiParam({
    name: 'commentId',
    example: 'cmcomment123',
  })
  findReplies(
    @Param('commentId') commentId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.commentsService.findReplies(commentId, query);
  }

  @Post('comments/:commentId/replies')
  @ApiCookieAuth('better-auth.session_token')
  @ApiOperation({
    summary: 'Reply to a comment',
  })
  @ApiParam({
    name: 'commentId',
    example: 'cmcomment123',
  })
  reply(
    @Param('commentId') commentId: string,
    @Body() dto: CreateCommentDto,
    @Session() session: UserSession,
  ) {
    return this.commentsService.reply(commentId, dto, session.user.id);
  }

  @Patch('comments/:commentId')
  @ApiCookieAuth('better-auth.session_token')
  @ApiOperation({
    summary: 'Update your own comment',
  })
  @ApiParam({
    name: 'commentId',
    example: 'cmcomment123',
  })
  update(
    @Param('commentId') commentId: string,
    @Body() dto: UpdateCommentDto,
    @Session() session: UserSession,
  ) {
    return this.commentsService.update(commentId, dto, session.user.id);
  }

  @Delete('comments/:commentId')
  @ApiCookieAuth('better-auth.session_token')
  @ApiOperation({
    summary: 'Soft-delete your own comment',
  })
  @ApiParam({
    name: 'commentId',
    example: 'cmcomment123',
  })
  remove(
    @Param('commentId') commentId: string,
    @Session() session: UserSession,
  ) {
    return this.commentsService.remove(commentId, session.user.id);
  }
}
