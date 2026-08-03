import { Injectable } from '@nestjs/common';
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
  }) {
    return this.prisma.post.findMany({
      ...params,
      include: postInclude,
    });
  }

  count(where: Prisma.PostWhereInput) {
    return this.prisma.post.count({
      where,
    });
  }

  findPublishedById(id: string) {
    return this.prisma.post.findFirst({
      where: {
        id,
        status: 'PUBLISHED',
        visibility: 'PUBLIC',
        deletedAt: null,
      },
      include: postInclude,
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
    return this.prisma.$transaction(async (tx) => {
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
         * updateMany ensures the upload is still UPLOADED at the exact time
         * it is attached. This protects against two simultaneous Post requests
         * attempting to reuse the same mediaUploadId.
         */
        for (const media of params.media) {
          const claimed = await tx.mediaUpload.updateMany({
            where: {
              id: media.mediaUploadId,
              userId: params.authorId,
              purpose: 'POST',
              status: 'UPLOADED',
            },
            data: {
              status: 'ATTACHED',
              attachedAt: new Date(),
            },
          });

          if (claimed.count !== 1) {
            throw new Error(
              `Media upload ${media.mediaUploadId} could not be claimed`,
            );
          }
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
    });
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
      if (params.tags !== undefined) {
        await tx.postTag.deleteMany({
          where: {
            postId: params.id,
          },
        });
      }

      return tx.post.update({
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
    });
  }

  softDelete(id: string, gameId: string, wasPublished: boolean) {
    return this.prisma.$transaction(async (tx) => {
      const post = await tx.post.update({
        where: {
          id,
        },
        data: {
          status: 'DELETED',
          deletedAt: new Date(),
        },
      });

      if (wasPublished) {
        await tx.game.update({
          where: {
            id: gameId,
          },
          data: {
            postCount: {
              decrement: 1,
            },
          },
        });
      }

      return post;
    });
  }
}
