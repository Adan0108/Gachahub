import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PostStatus, type Prisma } from '../generated/prisma/client';
import { escapeLikePattern } from '../common/utils/like-pattern';
import { slugify } from '../common/utils/slugify';

import { CreatePostDto } from './dto/create-post.dto';
import { PostSortDto, QueryPostsDto } from './dto/query-posts.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { PostsRepository } from './posts.repository';
import { MediaService } from '../media/media.service';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { formatPost } from './post.mapper';
import { PostVisibilityService } from '../post-visibility/post-visibility.service';
import { UserInterestService } from '../recommendation/user-interest.service';
import { resolvePagination, toPaginated } from '../common/utils/paginated';
import { EventPublisherPort } from '../domain-events/event-publisher.port';
import { MentionsService } from '../mentions/mentions.service';
import { PrismaService } from '../prisma/prisma.service';

const mentionText = (post: { title: string; content: string }) =>
  `${post.title}
${post.content}`;

@Injectable()
export class PostsService {
  constructor(
    private readonly postsRepository: PostsRepository,
    private readonly mediaService: MediaService,
    private readonly postVisibility: PostVisibilityService,
    private readonly userInterestService: UserInterestService,
    private readonly eventPublisher: EventPublisherPort,
    private readonly prisma: PrismaService,
    private readonly mentions: MentionsService,
  ) {}

  async findAll(query: QueryPostsDto, userId?: string) {
    const { page, limit, skip } = resolvePagination(query);

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
                  contains: escapeLikePattern(query.search),
                  mode: 'insensitive',
                },
              },
              {
                content: {
                  contains: escapeLikePattern(query.search),
                  mode: 'insensitive',
                },
              },
              {
                tags: {
                  some: {
                    tag: {
                      name: {
                        contains: escapeLikePattern(query.search),
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
            { saveCount: 'desc' },
            { commentCount: 'desc' },
            { reactionCount: 'desc' },
            { shareCount: 'desc' },
            { createdAt: 'desc' },
            { id: 'desc' },
          ]
        : [{ createdAt: 'desc' }, { id: 'desc' }];

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

    return toPaginated(
      items.map((post) => formatPost(post)),
      { page, limit, total: total },
    );
  }

  async findOne(id: string, userId?: string) {
    const post = await this.postsRepository.findViewableById(id, userId);

    if (!post || post.deletedAt || post.status === 'DELETED') {
      throw new NotFoundException('Post not found');
    }

    // Owner can view their own post regardless of
    // draft/private/followers-only status.
    if (userId && post.authorId === userId) {
      return formatPost(post);
    }

    // Everyone else follows the shared visibility rule.
    const viewable = await this.postVisibility.canView(post, userId);

    if (!viewable) {
      throw new NotFoundException('Post not found');
    }

    return formatPost(post);
  }

  async findByAuthor(
    query: PaginationQueryDto,
    authorId: string,
    userId?: string,
  ) {
    const { page, limit } = resolvePagination(query);

    const result = await this.postsRepository.findByAuthorId(authorId, {
      page,
      limit,
      audience: 'self',
      userId,
    });

    return toPaginated(
      result.items.map((post) => formatPost(post)),
      { page, limit, total: result.total },
    );
  }

  async findByAuthorPublic(
    query: PaginationQueryDto,
    authorId: string,
    userId?: string,
  ) {
    const { page, limit } = resolvePagination(query);

    const result = await this.postsRepository.findByAuthorId(authorId, {
      page,
      limit,
      audience: 'public',
      userId,
    });

    return toPaginated(
      result.items.map((post) => formatPost(post)),
      { page, limit, total: result.total },
    );
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

    // 0-10 images, or exactly one video, never mixed - enforced in
    // MediaService.resolveAttachableMedia, shared with ChatService's attach flow.
    const uploads = await this.mediaService.resolveAttachableMedia({
      ids: mediaReferences.map((item) => item.mediaUploadId),
      userId: authorId,
      purpose: 'POST',
      maxImages: 10,
      maxVideos: 1,
      entityLabel: 'post',
    });

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
      // Drafts notify nobody; the post's own visibility decides who may be pinged.
      afterCreate: (tx, created) =>
        created.status === 'PUBLISHED'
          ? this.mentions.publishMentions(
              {
                text: mentionText(created),
                actorId: authorId,
                entityType: 'POST',
                entityId: created.id,
                canView: (mentionedId) =>
                  this.postVisibility.canView(created, mentionedId),
              },
              tx,
            )
          : Promise.resolve(),
    });

    return formatPost(post);
  }

  async update(id: string, dto: UpdatePostDto, userId: string) {
    const existingPost = await this.postsRepository.findById(id);

    if (
      !existingPost ||
      existingPost.deletedAt ||
      existingPost.status === PostStatus.DELETED
    ) {
      throw new NotFoundException('Post not found');
    }

    if (existingPost.authorId !== userId) {
      throw new ForbiddenException('You can only update your own post');
    }

    if (existingPost.status === PostStatus.HIDDEN) {
      throw new ForbiddenException('This post was hidden by a moderator');
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
      // Newly added mentions ping on edit; publishing a draft pings everyone mentioned.
      afterUpdate: (tx, before, after) =>
        after.status === 'PUBLISHED'
          ? this.mentions.publishMentions(
              {
                text: mentionText(after),
                actorId: userId,
                entityType: 'POST',
                entityId: id,
                canView: (mentionedId) =>
                  this.postVisibility.canView(after, mentionedId),
                previous:
                  before.status === 'PUBLISHED'
                    ? {
                        text: mentionText(before),
                        canView: (mentionedId) =>
                          this.postVisibility.canView(before, mentionedId),
                      }
                    : undefined,
              },
              tx,
            )
          : Promise.resolve(),
    });

    return formatPost(post);
  }

  /**
   * Deleting is intentionally allowed even when a moderator hid the post -
   * unlike update(), delete doesn't undo the moderation decision, it goes
   * further in the same direction (the content becomes fully inaccessible
   * instead of just hidden). Blocking it would make hidden content
   * permanently undeletable through the API.
   */
  async remove(id: string, userId: string) {
    const post = await this.postsRepository.findById(id);

    if (!post || post.deletedAt || post.status === PostStatus.DELETED) {
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
    const post = await this.ensurePostCanBeInteractedWith(postId, userId);

    const result = await this.prisma.$transaction(async (transaction) => {
      const likeResult = await this.postsRepository.like(
        transaction,
        postId,
        userId,
      );

      if (likeResult.changed) {
        await this.eventPublisher.publish(
          {
            type: 'post.liked',
            aggregateId: postId,
            payload: {
              postId,
              postAuthorId: post.authorId,
              actorId: userId,
            },
          },
          transaction,
        );
      }

      return likeResult;
    });

    if (result.changed) {
      void this.userInterestService.recordPostInteraction(
        userId,
        postId,
        'LIKE',
      );
    }

    return {
      liked: result.liked,
      likeCount: result.likeCount,
    };
  }

  async unlike(postId: string, userId: string) {
    await this.ensurePostCanBeInteractedWith(postId, userId);

    const result = await this.postsRepository.unlike(postId, userId);

    if (result.changed) {
      /**
       * Recommendation updates are best-effort and should not block
       * the core unlike interaction.
       */
      void this.userInterestService.recordPostInteraction(
        userId,
        postId,
        'UNLIKE',
      );
    }

    return {
      liked: result.liked,
      likeCount: result.likeCount,
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

    if (!post) {
      throw new NotFoundException('Post not found');
    }

    const viewable = await this.postVisibility.canView(post, userId);

    if (!viewable) {
      throw new NotFoundException('Post not found');
    }

    return post;
  }
}
