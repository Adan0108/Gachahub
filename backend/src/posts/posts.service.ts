import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import { slugify } from '../common/utils/slugify';
import { CreatePostDto } from './dto/create-post.dto';
import { PostSortDto, QueryPostsDto } from './dto/query-posts.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { PostsRepository } from './posts.repository';

@Injectable()
export class PostsService {
  constructor(private readonly postsRepository: PostsRepository) {}

  async findAll(query: QueryPostsDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Prisma.PostWhereInput = {
      status: 'PUBLISHED',
      visibility: 'PUBLIC',
      deletedAt: null,

      ...(query.gameSlug
        ? {
            game: {
              slug: query.gameSlug,
              status: 'ACTIVE',
            },
          }
        : {}),

      ...(query.categorySlug
        ? {
            category: {
              slug: query.categorySlug,
              isActive: true,
            },
          }
        : {}),

      ...(query.type
        ? {
            type: query.type,
          }
        : {}),

      ...(query.search
        ? {
            OR: [
              {
                title: {
                  contains: query.search,
                  mode: 'insensitive',
                },
              },
              {
                content: {
                  contains: query.search,
                  mode: 'insensitive',
                },
              },
              {
                tags: {
                  some: {
                    tag: {
                      name: {
                        contains: query.search,
                        mode: 'insensitive',
                      },
                    },
                  },
                },
              },
            ],
          }
        : {}),
    };

    /*
     * Popular MVP chưa phải interest/recommendation algorithm.
     *
     * Nó đơn giản ưu tiên:
     * save > comment > reaction > share > bài mới.
     *
     * Khi thêm engagement modules, chúng ta sẽ thay bằng trending score
     * có time decay.
     */
    const orderBy: Prisma.PostOrderByWithRelationInput[] =
      query.sort === PostSortDto.POPULAR
        ? [
            {
              saveCount: 'desc',
            },
            {
              commentCount: 'desc',
            },
            {
              reactionCount: 'desc',
            },
            {
              shareCount: 'desc',
            },
            {
              createdAt: 'desc',
            },
          ]
        : [
            {
              createdAt: 'desc',
            },
          ];

    const [items, total] = await Promise.all([
      this.postsRepository.findMany({
        where,
        skip,
        take: limit,
        orderBy,
      }),
      this.postsRepository.count(where),
    ]);

    return {
      items: items.map((post) => this.formatPost(post)),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: string) {
    const post = await this.postsRepository.findPublishedById(id);

    if (!post) {
      throw new NotFoundException('Post not found');
    }

    return this.formatPost(post);
  }

  async create(dto: CreatePostDto, authorId: string) {
    const game = await this.postsRepository.findGameById(dto.gameId);

    if (!game || game.status !== 'ACTIVE') {
      throw new NotFoundException('Active game not found');
    }

    if (dto.categoryId) {
      const category = await this.postsRepository.findCategoryById(
        dto.categoryId,
      );

      if (!category || category.gameId !== dto.gameId || !category.isActive) {
        throw new NotFoundException(
          'Active category not found in the selected game',
        );
      }
    }

    const post = await this.postsRepository.create({
      authorId,
      gameId: dto.gameId,
      categoryId: dto.categoryId,
      title: dto.title.trim(),
      content: dto.content.trim(),
      type: dto.type,
      status: dto.status,
      visibility: dto.visibility,
      isSpoiler: dto.isSpoiler,

      media: dto.media?.map((item, index) => ({
        url: item.url,
        publicId: item.publicId,
        mediaType: item.mediaType,
        altText: item.altText,
        sortOrder: item.sortOrder ?? index,
      })),

      tags: this.normalizeTags(dto.tags),
    });

    return this.formatPost(post);
  }

  async update(id: string, dto: UpdatePostDto, userId: string) {
    const existingPost = await this.postsRepository.findById(id);

    if (!existingPost || existingPost.status === 'DELETED') {
      throw new NotFoundException('Post not found');
    }

    if (existingPost.authorId !== userId) {
      throw new ForbiddenException('You can only update your own post');
    }

    if (dto.categoryId) {
      const category = await this.postsRepository.findCategoryById(
        dto.categoryId,
      );

      if (
        !category ||
        category.gameId !== existingPost.gameId ||
        !category.isActive
      ) {
        throw new NotFoundException(
          'Active category not found in the post game',
        );
      }
    }

    const data: Prisma.PostUpdateInput = {
      ...(dto.categoryId !== undefined
        ? dto.categoryId
          ? {
              category: {
                connect: {
                  id: dto.categoryId,
                },
              },
            }
          : {
              category: {
                disconnect: true,
              },
            }
        : {}),

      ...(dto.title !== undefined
        ? {
            title: dto.title.trim(),
          }
        : {}),

      ...(dto.content !== undefined
        ? {
            content: dto.content.trim(),
          }
        : {}),

      ...(dto.type !== undefined
        ? {
            type: dto.type,
          }
        : {}),

      ...(dto.status !== undefined
        ? {
            status: dto.status,
          }
        : {}),

      ...(dto.visibility !== undefined
        ? {
            visibility: dto.visibility,
          }
        : {}),

      ...(dto.isSpoiler !== undefined
        ? {
            isSpoiler: dto.isSpoiler,
          }
        : {}),
    };

    const post = await this.postsRepository.update({
      id,
      data,
      tags: dto.tags !== undefined ? this.normalizeTags(dto.tags) : undefined,
    });

    return this.formatPost(post);
  }

  async remove(id: string, userId: string) {
    const post = await this.postsRepository.findById(id);

    if (!post || post.status === 'DELETED') {
      throw new NotFoundException('Post not found');
    }

    if (post.authorId !== userId) {
      throw new ForbiddenException('You can only delete your own post');
    }

    await this.postsRepository.softDelete(
      id,
      post.gameId,
      post.status === 'PUBLISHED',
    );

    return {
      message: 'Post deleted successfully',
    };
  }

  private normalizeTags(tags?: string[]) {
    if (tags === undefined) {
      return undefined;
    }

    const uniqueTags = new Map<
      string,
      {
        name: string;
        slug: string;
      }
    >();

    for (const rawTag of tags) {
      const name = rawTag.trim();
      const slug = slugify(name);

      if (name && slug) {
        uniqueTags.set(slug, {
          name,
          slug,
        });
      }
    }

    return [...uniqueTags.values()];
  }

  private formatPost<T extends { tags: Array<{ tag: unknown }> }>(post: T) {
    return {
      ...post,
      tags: post.tags.map((postTag) => postTag.tag),
    };
  }
}
