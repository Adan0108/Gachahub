import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const commentInclude = {
  author: {
    select: {
      id: true,
      image: true,
      name: true,
    },
  },
} as const;

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
        {
          deletedAt: null,
        },
        {
          replies: {
            some: {
              deletedAt: null,
            },
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
                where: {
                  deletedAt: null,
                },
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
      deletedAt: null,
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
  create(params: {
    postId: string;
    authorId: string;
    content: string;
    parentId?: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const comment = await tx.comment.create({
        data: {
          postId: params.postId,
          authorId: params.authorId,
          content: params.content,
          parentId: params.parentId,
        },
        include: commentInclude,
      });

      await tx.post.update({
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
    });
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
