import { Injectable, NotFoundException } from '@nestjs/common';
import { PostSaveRepository } from './post-save.repository';
import { PrismaService } from '../../prisma/prisma.service';
import { loadActiveUser } from '../../common/guards/active-user.util';
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
    private readonly prisma: PrismaService,
    private readonly posts: PostsRepository,
    private readonly visibility: PostVisibilityService,
  ) {}

  async save(userId: string, postId: string): Promise<SavePostResponse> {
    const user = await loadActiveUser(this.prisma, userId);
    const post = await this.posts.findPostForInteraction(postId);
    if (!post || !(await this.visibility.canView(post, user.id))) {
      throw new NotFoundException('Post not found');
    }
    return this.repository.save(user.id, postId);
  }

  async unsave(userId: string, postId: string): Promise<UnsavePostResponse> {
    const user = await loadActiveUser(this.prisma, userId);
    return this.repository.unsave(user.id, postId);
  }

  async list(
    userId: string,
    query: QuerySavedPostsDto,
  ): Promise<SavedPostsResponse> {
    const user = await loadActiveUser(this.prisma, userId);
    const limit = query.limit ?? 20;
    const cursor =
      query.cursor === undefined
        ? undefined
        : decodeSavedPostCursor(query.cursor);
    const rows = await this.repository.findSavedPage(
      user.id,
      limit + 1,
      cursor,
    );
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
