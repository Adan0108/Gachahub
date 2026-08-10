import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { CreateCommentDto } from './dto/create-comment.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';
import { CommentsRepository } from './comments.repository';

@Injectable()
export class CommentsService {
  constructor(private readonly commentsRepository: CommentsRepository) {}

  async findByPost(postId: string, query: PaginationQueryDto) {
    await this.ensurePostCanBeViewed(postId);

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const result = await this.commentsRepository.findByPostId(postId, {
      page,
      limit,
    });

    return {
      items: result.items.map((comment) => this.formatComment(comment)),
      meta: {
        page,
        limit,
      },
    };
  }

  private async ensurePostCanBeViewed(postId: string) {
    const post = await this.commentsRepository.findPostById(postId);

    if (
      !post ||
      post.deletedAt ||
      post.status !== 'PUBLISHED' ||
      post.visibility !== 'PUBLIC'
    ) {
      throw new NotFoundException('Post not found');
    }

    return post;
  }

  /**
   * Central place for comment interaction rules.
   * Later this can also check locked posts, moderation,
   * follower-only visibility, blocked users, etc.
   */
  private async ensurePostCanBeCommentedOn(postId: string) {
    return this.ensurePostCanBeViewed(postId);
  }

  private formatComment<
    T extends {
      id: string;
      postId: string;
      authorId: string;
      parentId: string | null;
      content: string;
      createdAt: Date;
      updatedAt: Date;
      deletedAt: Date | null;
      author: {
        id: string;
        name: string;
        image: string | null;
      };
      _count?: {
        replies: number;
      };
    },
  >(comment: T) {
    const { _count, ...rest } = comment;

    return {
      ...rest,

      // Preserve the thread when a parent comment is deleted,
      // but do not expose its old content.
      content: comment.deletedAt ? null : comment.content,

      replyCount: _count?.replies ?? 0,
    };
  }
}
