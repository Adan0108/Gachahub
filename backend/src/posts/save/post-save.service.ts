import { Injectable, NotFoundException } from '@nestjs/common';
import { PostSaveRepository } from './post-save.repository';
import { PostsRepository } from '../posts.repository';
import { PostVisibilityService } from '../../post-visibility/post-visibility.service';
import { formatPost } from '../post.mapper';
import { QuerySavedPostsDto } from './dto/query-saved-posts.dto';
import {
  decodeSavedPostCursor,
  encodeSavedPostCursor,
} from './saved-post-cursor.util';

import type {
  SavePostResponse,
  UnsavePostResponse,
  SavedPostsResponse,
} from './post-save.types';

@Injectable()
export class PostSaveService {
  constructor(
    private readonly repository: PostSaveRepository,
    private readonly posts: PostsRepository,
    private readonly visibility: PostVisibilityService,
  ) {}

  async save(userId: string, postId: string): Promise<SavePostResponse> {
    const post = await this.posts.findPostForInteraction(postId);
    if (!post || !(await this.visibility.canView(post, userId))) {
      throw new NotFoundException('Post not found');
    }
    return this.repository.save(userId, postId);
  }

  async unsave(userId: string, postId: string): Promise<UnsavePostResponse> {
    return this.repository.unsave(userId, postId);
  }

  async list(
    userId: string,
    query: QuerySavedPostsDto,
  ): Promise<SavedPostsResponse> {
    const limit = query.limit;
    const cursor =
      query.cursor === undefined
        ? undefined
        : decodeSavedPostCursor(query.cursor);
    const rows = await this.repository.findSavedPage(userId, limit + 1, cursor);
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: page.map((row) => ({
        ...formatPost(row.post),
        savedAt: row.createdAt,
      })),
      hasMore,
      nextCursor:
        hasMore && last
          ? encodeSavedPostCursor({
              savedAt: last.createdAt,
              postId: last.postId,
            })
          : null,
    };
  }
}
