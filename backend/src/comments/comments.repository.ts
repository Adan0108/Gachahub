import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { Prisma } from '../generated/prisma/client';

const commentInclude = {
  author: {
    select: {
      id: true,
      image: true,
      name: true,
    },
  },
} as const;

/**
 * A comment the public can see: not soft-deleted and not hidden by a
 * moderator. Named so every place that decides "is this comment visible"
 * uses the exact same two-field predicate - findByPostId's OR branches,
 * its reply _count, and findReplies all have to agree, or a hidden reply
 * disappears from one and still gets counted by another.
 */
const VISIBLE_COMMENT = { deletedAt: null, status: 'PUBLISHED' } as const;

@Injectable()
export class CommentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Finds a post before allowing comment interactions
   * Business rules such as whether the post can be commented on
   * are handled by CommentsSerivice
   */
  findPostById(postId: string) {
    return this.prisma.post.findUnique({
      where: {
        id: postId,
      },
      select: {
        id: true,
        authorId: true,
        status: true,
        visibility: true,
        deletedAt: true,
      },
    });
  }

  findById(id: string) {
    return this.prisma.comment.findUnique({
      where: {
        id,
      },
      include: commentInclude,
    });
  }

  /**
   * Comments have no gameId of their own (unlike Post), so the moderation
   * preamble can't use GameModeratorsService.loadModeratableResource
   * generically - the caller cross-checks post.gameId by hand instead.
   */
  findByIdForModeration(id: string) {
    return this.prisma.comment.findUnique({
      where: {
        id,
      },
      select: {
        id: true,
        content: true,
        authorId: true,
        status: true,
        deletedAt: true,
        createdAt: true,
        updatedAt: true,
        parentId: true,
        author: {
          select: {
            id: true,
            image: true,
            name: true,
          },
        },
        post: {
          select: {
            id: true,
            gameId: true,
          },
        },
      },
    });
  }

  /**
   * Moves a comment from one status to another only if it's still at `from`
   * when the write happens - same race protection as
   * PostsRepository.transitionStatus. Returns null when the row was no
   * longer at `from`.
   */
  transitionStatus(params: {
    id: string;
    postId: string;
    from: Prisma.CommentWhereInput['status'];
    to: Prisma.CommentUpdateInput['status'];
  }) {
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.comment.updateMany({
        where: {
          id: params.id,
          status: params.from,
        },
        data: {
          status: params.to,
        },
      });

      if (result.count === 0) {
        return null;
      }

      // Post.commentCount is a denormalized count of visible comments (see
      // create()/softDelete()) - hiding/restoring has to keep it in step the
      // same way deleting does, or a hidden comment keeps being counted.
      const delta =
        params.to === 'PUBLISHED' ? 1 : params.from === 'PUBLISHED' ? -1 : 0;

      if (delta !== 0) {
        await tx.post.update({
          where: {
            id: params.postId,
          },
          data: {
            commentCount: {
              increment: delta,
            },
          },
        });
      }

      return tx.comment.findUniqueOrThrow({
        where: {
          id: params.id,
        },
        include: commentInclude,
      });
    });
  }

  /**
   * Comments a moderator hid in their game, for the "restore" workflow -
   * mirrors PostsRepository.findHiddenByGame.
   */
  async findHiddenByGame(
    gameId: string,
    params: {
      page: number;
      limit: number;
    },
  ) {
    const skip = (params.page - 1) * params.limit;

    const where: Prisma.CommentWhereInput = {
      status: 'HIDDEN',
      deletedAt: null,
      post: {
        gameId,
      },
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.comment.findMany({
        where,
        include: commentInclude,
        orderBy: [
          {
            updatedAt: 'desc',
          },
          {
            id: 'desc',
          },
        ],
        skip,
        take: params.limit,
      }),

      this.prisma.comment.count({
        where,
      }),
    ]);

    return {
      items,
      total,
    };
  }

  /**
   * Hydrates the comment side of the cross-game flagged-content listing -
   * ContentModerationService already knows which ids it needs from the
   * report counts, so this is a plain batch fetch, not a search.
   */
  async findManyByIdsForModeration(ids: string[]) {
    if (ids.length === 0) {
      return [];
    }

    return this.prisma.comment.findMany({
      where: {
        id: {
          in: ids,
        },
      },
      select: {
        id: true,
        content: true,
        status: true,
        deletedAt: true,
        author: {
          select: {
            name: true,
          },
        },
        post: {
          select: {
            game: {
              select: {
                slug: true,
              },
            },
          },
        },
      },
    });
  }

  /**
   * Returns root comments only.
   * Replies are retrieved seperately so a post with many replies
   * does not create an unnecessary response.
   */
  async findByPostId(
    postId: string,
    params: {
      page: number;
      limit: number;
    },
  ) {
    const skip = (params.page - 1) * params.limit;

    /*
     * Root comment is returned when:
     * - it has not been deleted, or
     * - it was deleted but still has visible replies that need the
     *   parent placeholder to preserve the conversation thread.
     */
    const where = {
      postId,
      parentId: null,
      OR: [
        VISIBLE_COMMENT,
        {
          replies: {
            some: VISIBLE_COMMENT,
          },
        },
      ],
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.comment.findMany({
        where,
        include: {
          ...commentInclude,

          // Count only replies that are still visible.
          _count: {
            select: {
              replies: {
                where: VISIBLE_COMMENT,
              },
            },
          },
        },
        orderBy: [
          {
            createdAt: 'desc',
          },
          {
            id: 'desc',
          },
        ],
        skip,
        take: params.limit,
      }),

      this.prisma.comment.count({
        where,
      }),
    ]);

    return {
      items,
      total,
    };
  }

  /**
   * Replies are paginated independently from root comments.
   */

  async findReplies(
    parentId: string,
    params: {
      page: number;
      limit: number;
    },
  ) {
    const skip = (params.page - 1) * params.limit;

    const where = {
      parentId,
      ...VISIBLE_COMMENT,
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.comment.findMany({
        where,
        include: commentInclude,
        orderBy: [
          {
            createdAt: 'asc',
          },
          {
            id: 'asc',
          },
        ],
        skip,
        take: params.limit,
      }),

      this.prisma.comment.count({
        where,
      }),
    ]);
    return {
      items,
      total,
    };
  }

  /**
   * Comment creation and Post.commentCoutn update must succed
   * together so the cached counter cannot become out of sync
   */
  async create(
    transaction: Prisma.TransactionClient,
    params: {
      postId: string;
      authorId: string;
      content: string;
      parentId?: string;
    },
  ) {
    const comment = await transaction.comment.create({
      data: {
        postId: params.postId,
        authorId: params.authorId,
        content: params.content,
        parentId: params.parentId,
      },
      include: commentInclude,
    });

    await transaction.post.update({
      where: {
        id: params.postId,
      },
      data: {
        commentCount: {
          increment: 1,
        },
      },
    });

    return comment;
  }

  update(id: string, content: string) {
    return this.prisma.comment.update({
      where: {
        id,
      },
      data: {
        content,
      },
      include: commentInclude,
    });
  }

  /**
   * Soft-delete keeps the record so replies can remain attached
   * to their original conversation thread
   */
  softDelete(id: string, postId: string) {
    return this.prisma.$transaction(async (tx) => {
      const deleted = await tx.comment.updateMany({
        where: {
          id,
          deletedAt: null,
        },
        data: {
          deletedAt: new Date(),
        },
      });

      if (deleted.count === 0) {
        return null;
      }

      await tx.post.update({
        where: {
          id: postId,
        },
        data: {
          commentCount: {
            decrement: 1,
          },
        },
      });

      return tx.comment.findUnique({
        where: {
          id,
        },
        include: commentInclude,
      });
    });
  }
}
