import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { claimUploadsForAttachment } from '../media/media.repository';
import { viewablePostWhere } from '../post-visibility/visibility-where';

export const postInclude = {
  author: {
    select: {
      id: true,
      name: true,
      image: true,
    },
  },
  game: {
    select: {
      id: true,
      name: true,
      slug: true,
      iconUrl: true,
    },
  },
  category: {
    select: {
      id: true,
      name: true,
      slug: true,
    },
  },
  media: {
    orderBy: {
      sortOrder: 'asc' as const,
    },
  },
  tags: {
    include: {
      tag: true,
    },
  },
} satisfies Prisma.PostInclude;

/** The viewer's own like/save flags; `false` for an anonymous reader so Prisma skips the joins. */
const viewerInteractions = (userId?: string) =>
  userId
    ? {
        postLikes: { where: { userId }, select: { userId: true } },
        postSaves: { where: { userId }, select: { userId: true } },
      }
    : { postLikes: false as const, postSaves: false as const };

@Injectable()
export class PostsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findMany(params: {
    where: Prisma.PostWhereInput;
    skip: number;
    take: number;
    orderBy:
      | Prisma.PostOrderByWithRelationInput
      | Prisma.PostOrderByWithRelationInput[];
    userId?: string;
  }) {
    const { userId, ...query } = params;

    return this.prisma.post.findMany({
      ...query,
      include: {
        ...postInclude,
        ...viewerInteractions(userId),
      },
    });
  }

  /**
   * Loads one chronological Latest page strictly after the compound cursor.
   *
   * Both createdAt and id participate in the boundary so posts sharing the
   * same timestamp are neither skipped nor repeated between pages.
   */
  findLatestPage(params: {
    where: Prisma.PostWhereInput;
    cursor?: {
      createdAt: Date;
      id: string;
    };
    take: number;
    userId?: string;
  }) {
    const { where, cursor, take, userId } = params;

    return this.prisma.post.findMany({
      where: cursor
        ? {
            AND: [
              where,
              {
                OR: [
                  {
                    createdAt: {
                      lt: cursor.createdAt,
                    },
                  },
                  {
                    createdAt: cursor.createdAt,
                    id: {
                      lt: cursor.id,
                    },
                  },
                ],
              },
            ],
          }
        : where,
      orderBy: [
        {
          createdAt: 'desc',
        },
        {
          id: 'desc',
        },
      ],
      take,
      include: {
        ...postInclude,
        ...viewerInteractions(userId),
      },
    });
  }

  // No optional visibility/status with a permissive default - a caller must state whose eyes these posts are for.
  async findByAuthorId(
    authorId: string,
    params: {
      page: number;
      limit: number;
      audience: 'self' | 'public';
      userId?: string;
    },
  ) {
    const skip = (params.page - 1) * params.limit;

    const where: Prisma.PostWhereInput =
      params.audience === 'public'
        ? { authorId, ...viewablePostWhere(params.userId) }
        : { authorId, deletedAt: null };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.post.findMany({
        where,
        include: {
          ...postInclude,
          ...viewerInteractions(params.userId),
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

      this.prisma.post.count({
        where,
      }),
    ]);

    return {
      items,
      total,
    };
  }

  /**
   * Posts a moderator hid in their game, for the "restore" workflow -
   * mirrors findByAuthorId's shape (where/pagination owned here, not by the
   * caller) rather than having callers hand-build a Prisma where clause.
   */
  async findHiddenByGame(
    gameId: string,
    params: {
      page: number;
      limit: number;
    },
  ) {
    const skip = (params.page - 1) * params.limit;

    const where: Prisma.PostWhereInput = {
      gameId,
      status: 'HIDDEN',
      deletedAt: null,
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.post.findMany({
        where,
        include: postInclude,
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

      this.prisma.post.count({
        where,
      }),
    ]);

    return {
      items,
      total,
    };
  }

  count(where: Prisma.PostWhereInput) {
    return this.prisma.post.count({
      where,
    });
  }

  findViewableById(id: string, userId?: string) {
    return this.prisma.post.findUnique({
      where: {
        id,
      },
      include: {
        ...postInclude,
        ...viewerInteractions(userId),
      },
    });
  }

  findById(id: string) {
    return this.prisma.post.findUnique({
      where: {
        id,
      },
      include: postInclude,
    });
  }

  findGameById(id: string) {
    return this.prisma.game.findUnique({
      where: {
        id,
      },
    });
  }

  findCategoryById(id: string) {
    return this.prisma.gameCategory.findUnique({
      where: {
        id,
      },
    });
  }

  async create(
    tx: Prisma.TransactionClient,
    params: {
      authorId: string;
      gameId: string;
      categoryId?: string;
      title: string;
      content: string;
      type?: Prisma.PostCreateInput['type'];
      status?: Prisma.PostCreateInput['status'];
      visibility?: Prisma.PostCreateInput['visibility'];
      isSpoiler?: boolean;
      media?: Array<{
        mediaUploadId: string;
        assetId: string;
        publicId: string;
        url: string;
        mediaType: 'IMAGE' | 'GIF' | 'VIDEO';
        altText?: string;
        sortOrder: number;
        width: number | null;
        height: number | null;
        duration: number | null;
        bytes: number | null;
        format: string | null;
      }>;
      tags?: Array<{
        name: string;
        slug: string;
      }>;
    },
  ) {
    const post = await tx.post.create({
      data: {
        author: {
          connect: {
            id: params.authorId,
          },
        },
        game: {
          connect: {
            id: params.gameId,
          },
        },
        ...(params.categoryId
          ? {
              category: {
                connect: {
                  id: params.categoryId,
                },
              },
            }
          : {}),
        title: params.title,
        content: params.content,
        type: params.type,
        status: params.status,
        visibility: params.visibility,
        isSpoiler: params.isSpoiler,
        tags: params.tags?.length
          ? {
              create: params.tags.map((tag) => ({
                tag: {
                  connectOrCreate: {
                    where: {
                      slug: tag.slug,
                    },
                    create: tag,
                  },
                },
              })),
            }
          : undefined,
      },
    });

    if (params.media?.length) {
      const mediaUploadIds = params.media.map((media) => media.mediaUploadId);

      await claimUploadsForAttachment(tx, {
        ids: mediaUploadIds,
        userId: params.authorId,
        purpose: 'POST',
      });

      await tx.postMedia.createMany({
        data: params.media.map((media) => ({
          postId: post.id,
          mediaUploadId: media.mediaUploadId,
          assetId: media.assetId,
          publicId: media.publicId,
          url: media.url,
          mediaType: media.mediaType,
          altText: media.altText,
          sortOrder: media.sortOrder,
          width: media.width,
          height: media.height,
          duration: media.duration,
          bytes: media.bytes,
          format: media.format,
        })),
      });
    }

    if (post.status === 'PUBLISHED') {
      await tx.game.update({
        where: {
          id: params.gameId,
        },
        data: {
          postCount: {
            increment: 1,
          },
        },
      });
    }

    return tx.post.findUniqueOrThrow({
      where: {
        id: post.id,
      },
      include: postInclude,
    });
  }

  async update(
    tx: Prisma.TransactionClient,
    params: {
      id: string;
      data: Prisma.PostUpdateInput;
      tags?: Array<{
        name: string;
        slug: string;
      }>;
    },
  ) {
    const before = await tx.post.findUniqueOrThrow({
      where: {
        id: params.id,
      },
      select: {
        status: true,
        gameId: true,
      },
    });

    if (params.tags !== undefined) {
      await tx.postTag.deleteMany({
        where: {
          postId: params.id,
        },
      });
    }

    const updated = await tx.post.update({
      where: {
        id: params.id,
      },
      data: {
        ...params.data,
        ...(params.tags !== undefined
          ? {
              tags: {
                create: params.tags.map((tag) => ({
                  tag: {
                    connectOrCreate: {
                      where: {
                        slug: tag.slug,
                      },
                      create: tag,
                    },
                  },
                })),
              },
            }
          : {}),
      },
      include: postInclude,
    });

    if (before.status !== updated.status) {
      const delta =
        updated.status === 'PUBLISHED'
          ? 1
          : before.status === 'PUBLISHED'
            ? -1
            : 0;

      if (delta !== 0) {
        await tx.game.update({
          where: {
            id: before.gameId,
          },
          data: {
            postCount: {
              increment: delta,
            },
          },
        });
      }
    }

    return updated;
  }

  /**
   * Moves a post from one status to another only if it's still at `from`
   * when the write happens - unlike update(), which reads then writes with
   * no guarantee the row hasn't changed in between. Used by moderation
   * hide/restore, where two moderators (or a moderator and the author)
   * racing the same post would otherwise silently lose one side's change.
   * Returns null when the row was no longer at `from` (someone else moved
   * it first), instead of throwing, so the caller decides what that means.
   *
   * Takes the caller's transaction client rather than opening its own, so
   * PostModerationService can write the audit entry in the same transaction
   * (recordOrThrow) - a moderation action can't land with no trail.
   */
  async transitionStatus(
    tx: Prisma.TransactionClient,
    params: {
      id: string;
      gameId: string;
      from: Prisma.PostWhereInput['status'];
      to: Prisma.PostUpdateInput['status'];
    },
  ) {
    const result = await tx.post.updateMany({
      where: {
        id: params.id,
        gameId: params.gameId,
        status: params.from,
      },
      data: {
        status: params.to,
      },
    });

    if (result.count === 0) {
      return null;
    }

    const delta =
      params.to === 'PUBLISHED' ? 1 : params.from === 'PUBLISHED' ? -1 : 0;

    if (delta !== 0) {
      await tx.game.update({
        where: {
          id: params.gameId,
        },
        data: {
          postCount: {
            increment: delta,
          },
        },
      });
    }

    return tx.post.findUniqueOrThrow({
      where: {
        id: params.id,
      },
      include: postInclude,
    });
  }

  softDelete(id: string) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.post.findUniqueOrThrow({
        where: {
          id,
        },
        select: {
          status: true,
          gameId: true,
          deletedAt: true,
        },
      });

      if (before.deletedAt || before.status === 'DELETED') {
        return tx.post.findUniqueOrThrow({
          where: {
            id,
          },
        });
      }

      const deleted = await tx.post.updateMany({
        where: {
          id,
          deletedAt: null,
        },
        data: {
          status: 'DELETED',
          deletedAt: new Date(),
        },
      });

      if (deleted.count === 0) {
        return tx.post.findUniqueOrThrow({
          where: {
            id,
          },
        });
      }

      if (before.status === 'PUBLISHED') {
        await tx.game.update({
          where: {
            id: before.gameId,
          },
          data: {
            postCount: {
              decrement: 1,
            },
          },
        });
      }

      return tx.post.findUniqueOrThrow({
        where: {
          id,
        },
      });
    });
  }

  async like(
    transaction: Prisma.TransactionClient,
    postId: string,
    userId: string,
  ) {
    const created = await transaction.postLike.createMany({
      data: [
        {
          postId,
          userId,
        },
      ],
      skipDuplicates: true,
    });

    if (created.count > 0) {
      const post = await transaction.post.update({
        where: {
          id: postId,
        },
        data: {
          reactionCount: {
            increment: 1,
          },
        },
        select: {
          reactionCount: true,
        },
      });

      return {
        liked: true,
        likeCount: post.reactionCount,
        changed: true,
      };
    }

    const post = await transaction.post.findUniqueOrThrow({
      where: {
        id: postId,
      },
      select: {
        reactionCount: true,
      },
    });

    return {
      liked: true,
      likeCount: post.reactionCount,
      changed: false,
    };
  }
  async unlike(postId: string, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const deleted = await tx.postLike.deleteMany({
        where: {
          postId,
          userId,
        },
      });

      if (deleted.count > 0) {
        const post = await tx.post.update({
          where: {
            id: postId,
          },
          data: {
            reactionCount: {
              decrement: 1,
            },
          },
          select: {
            reactionCount: true,
          },
        });

        return {
          liked: false,
          likeCount: post.reactionCount,
          changed: true,
        };
      }

      const post = await tx.post.findUniqueOrThrow({
        where: {
          id: postId,
        },
        select: {
          reactionCount: true,
        },
      });

      return {
        liked: false,
        likeCount: post.reactionCount,
        changed: false,
      };
    });
  }

  findManyByIds(ids: string[], userId?: string) {
    if (ids.length === 0) {
      return [];
    }

    return this.prisma.post.findMany({
      where: {
        id: {
          in: ids,
        },
        status: 'PUBLISHED',
        deletedAt: null,
      },

      include: {
        ...postInclude,
        ...viewerInteractions(userId),
      },
    });
  }

  /**
   * Hydrates frozen For You snapshot IDs while reapplying the requesting
   * user's current eligibility and visibility rules.
   */
  async findForYouManyByIds(
    ids: string[],
    where: Prisma.PostWhereInput,
    userId: string,
  ) {
    if (ids.length === 0) {
      return [];
    }

    return this.prisma.post.findMany({
      where: {
        AND: [
          where,
          {
            id: {
              in: ids,
            },
          },
        ],
      },
      include: {
        ...postInclude,
        ...viewerInteractions(userId),
      },
    });
  }

  /**
   * Hydrates the post side of the cross-game flagged-content listing -
   * ContentModerationService already knows which ids it needs from the
   * report counts, so this is a plain batch fetch, not a search. Unlike
   * findManyByIds, this is not restricted to PUBLISHED - a moderator needs
   * to see hidden posts too.
   */
  async findManyByIdsForModeration(ids: string[]) {
    if (ids.length === 0) {
      return [];
    }

    return this.prisma.post.findMany({
      where: {
        id: {
          in: ids,
        },
      },
      select: {
        id: true,
        title: true,
        status: true,
        author: {
          select: {
            name: true,
          },
        },
        game: {
          select: {
            slug: true,
          },
        },
      },
    });
  }

  /**
   * Hydrates Trending snapshot IDs while reapplying the live feed filters.
   *
   * Snapshot order is restored by FeedService because Prisma IN queries do
   * not preserve the order of the supplied IDs.
   */
  async findTrendingManyByIds(
    ids: string[],
    where: Prisma.PostWhereInput,
    userId?: string,
  ) {
    if (ids.length === 0) {
      return [];
    }

    return this.prisma.post.findMany({
      where: {
        AND: [
          where,
          {
            id: {
              in: ids,
            },
          },
        ],
      },
      include: {
        ...postInclude,
        ...viewerInteractions(userId),
      },
    });
  }

  findPostForInteraction(postId: string) {
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
}
