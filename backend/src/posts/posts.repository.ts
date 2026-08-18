import { ConflictException, Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const postInclude = {
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
        postLikes: userId
          ? {
              where: {
                userId,
              },
              select: {
                userId: true,
              },
            }
          : false,
      },
    });
  }

  async findByAuthorId(
    authorId: string,
    params: {
      page: number;
      limit: number;
      visibility?: Prisma.PostWhereInput['visibility'];
      status?: Prisma.PostWhereInput['status'];
    },
  ) {
    const skip = (params.page - 1) * params.limit;

    const where: Prisma.PostWhereInput = {
      authorId,
      deletedAt: null,

      ...(params.visibility
        ? {
            visibility: params.visibility,
          }
        : {}),

      ...(params.status
        ? {
            status: params.status,
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.post.findMany({
        where,
        include: postInclude,
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

  count(where: Prisma.PostWhereInput) {
    return this.prisma.post.count({
      where,
    });
  }

  findPublishedById(id: string, userId?: string) {
    return this.prisma.post.findFirst({
      where: {
        id,
        status: 'PUBLISHED',
        visibility: 'PUBLIC',
        deletedAt: null,
      },
      include: {
        ...postInclude,
        postLikes: userId
          ? {
              where: {
                userId,
              },
              select: {
                userId: true,
              },
            }
          : false,
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

  create(params: {
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
  }) {
    return this.prisma.$transaction(
      async (tx) => {
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
          /*
           * updateMany ensures the uploads are still UPLOADED at the exact time
           * they are attached. This protects against two simultaneous Post
           * requests attempting to reuse the same mediaUploadId.
           */
          const mediaUploadIds = params.media.map(
            (media) => media.mediaUploadId,
          );

          const claimed = await tx.mediaUpload.updateMany({
            where: {
              id: {
                in: mediaUploadIds,
              },
              userId: params.authorId,
              purpose: 'POST',
              status: 'UPLOADED',
            },
            data: {
              status: 'ATTACHED',
              attachedAt: new Date(),
            },
          });

          if (claimed.count !== mediaUploadIds.length) {
            throw new ConflictException(
              'One or more media uploads could not be attached',
            );
          }

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
      },
      {
        maxWait: 5_000,
        timeout: 15_000,
      },
    );
  }

  update(params: {
    id: string;
    data: Prisma.PostUpdateInput;
    tags?: Array<{
      name: string;
      slug: string;
    }>;
  }) {
    return this.prisma.$transaction(async (tx) => {
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

  async like(postId: string, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.postLike.createMany({
        data: [
          {
            postId,
            userId,
          },
        ],
        skipDuplicates: true,
      });

      if (created.count > 0) {
        const post = await tx.post.update({
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
        liked: true,
        likeCount: post.reactionCount,
      };
    });
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
      };
    });
  }

  findManyByIds(ids: string[]) {
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

      include: postInclude,
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
