import {
  BadRequestException,
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
import { MediaService } from '../media/media.service';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { formatPost } from './post.mapper';
import { FollowsService } from '../follows/follows.service';

@Injectable()
export class PostsService {
  constructor(
    private readonly postsRepository: PostsRepository,
    private readonly mediaService: MediaService,
    private readonly followsService: FollowsService,
  ) {}

  async findAll(query: QueryPostsDto, userId?: string) {
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
        userId,
      }),
      this.postsRepository.count(where),
    ]);

    return {
      items: items.map((post) => formatPost(post)),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: string, userId?: string) {
    const post = await this.postsRepository.findPublishedById(id, userId);

    if (!post) {
      throw new NotFoundException('Post not found');
    }

    return formatPost(post);
  }

  async findByAuthor(query: PaginationQueryDto, authorId: string) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const result = await this.postsRepository.findByAuthorId(authorId, {
      page,
      limit,
    });

    return {
      items: result.items.map((post) => formatPost(post)),
      meta: {
        page,
        limit,
        total: result.total,
        totalPages: Math.ceil(result.total / limit),
      },
    };
  }

  async findByAuthorPublic(query: PaginationQueryDto, authorId: string) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const result = await this.postsRepository.findByAuthorId(authorId, {
      page,
      limit,
      visibility: 'PUBLIC',
      status: 'PUBLISHED',
    });

    return {
      items: result.items.map((post) => formatPost(post)),
      meta: {
        page,
        limit,
        total: result.total,
        totalPages: Math.ceil(result.total / limit),
      },
    };
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

    const mediaReferences = dto.media ?? [];

    const uploads = await this.mediaService.getAttachableUploads({
      ids: mediaReferences.map((item) => item.mediaUploadId),
      userId: authorId,
      purpose: 'POST',
    });

    /*
     * MVP policy:
     * - 0–10 images, or
     * - exactly one video
     * - images and video cannot be mixed
     */
    const imageCount = uploads.filter(
      (upload) => upload.resourceType === 'IMAGE',
    ).length;

    const videoCount = uploads.filter(
      (upload) => upload.resourceType === 'VIDEO',
    ).length;

    if (imageCount > 10) {
      throw new BadRequestException('A post supports at most 10 images');
    }

    if (videoCount > 1) {
      throw new BadRequestException('A post supports at most one video');
    }

    if (imageCount > 0 && videoCount > 0) {
      throw new BadRequestException(
        'A post cannot mix images and video in the MVP',
      );
    }

    const referenceMap = new Map(
      mediaReferences.map((item, index) => [
        item.mediaUploadId,
        {
          altText: item.altText,
          sortOrder: item.sortOrder ?? index,
        },
      ]),
    );

    const media = uploads.map((upload) => {
      const reference = referenceMap.get(upload.id);

      return {
        mediaUploadId: upload.id,
        assetId: upload.assetId!,
        publicId: upload.publicId,
        url: upload.secureUrl!,
        mediaType:
          upload.resourceType === 'IMAGE'
            ? upload.format === 'gif'
              ? ('GIF' as const)
              : ('IMAGE' as const)
            : ('VIDEO' as const),
        altText: reference?.altText,
        sortOrder: reference?.sortOrder ?? 0,
        width: upload.width,
        height: upload.height,
        duration: upload.duration,
        bytes: upload.bytes,
        format: upload.format,
      };
    });

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
      media,
      tags: this.normalizeTags(dto.tags),
    });

    return formatPost(post);
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

    return formatPost(post);
  }

  async remove(id: string, userId: string) {
    const post = await this.postsRepository.findById(id);

    if (!post || post.status === 'DELETED') {
      throw new NotFoundException('Post not found');
    }

    if (post.authorId !== userId) {
      throw new ForbiddenException('You can only delete your own post');
    }

    await this.postsRepository.softDelete(id);

    return {
      message: 'Post deleted successfully',
    };
  }

  async like(postId: string, userId: string) {
    await this.ensurePostCanBeInteractedWith(postId, userId);

    return this.postsRepository.like(postId, userId);
  }

  async unlike(postId: string, userId: string) {
    await this.ensurePostCanBeInteractedWith(postId, userId);

    return this.postsRepository.unlike(postId, userId);
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

  /**
   * Checks whether the current user is allowed to interact with a post.
   *
   * Shared interactions such as like/unlike are allowed for:
   * - PUBLIC published posts
   * - FOLLOWERS_ONLY published posts when the user is the author
   *   or follows the author
   *
   * PRIVATE, non-published and deleted posts are treated as not found
   * so callers cannot use the interaction endpoint to discover hidden posts.
   */
  private async ensurePostCanBeInteractedWith(postId: string, userId: string) {
    const post = await this.postsRepository.findPostForInteraction(postId);

    if (!post || post.deletedAt || post.status !== 'PUBLISHED') {
      throw new NotFoundException('Post not found');
    }

    if (post.visibility === 'PUBLIC') {
      return post;
    }

    if (post.visibility === 'FOLLOWERS_ONLY') {
      if (post.authorId === userId) {
        return post;
      }

      const followStatus = await this.followsService.isFollowing(
        userId,
        post.authorId,
      );

      if (followStatus.following) {
        return post;
      }
    }

    throw new NotFoundException('Post not found');
  }
}
