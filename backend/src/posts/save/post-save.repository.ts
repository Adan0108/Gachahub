import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { viewablePostWhere } from '../../post-visibility/visibility-where';
import { postInclude } from '../posts.repository';
import type { Prisma } from '../../generated/prisma/client';
import type { SavePostResponse, UnsavePostResponse } from './post-save.types';
import type { SavedPostCursor } from './saved-post-cursor.util';

function savedPostSelect(userId: string) {
  return {
    createdAt: true,
    postId: true,
    post: {
      include: {
        ...postInclude,
        postLikes: { where: { userId }, select: { userId: true } },
        postSaves: { where: { userId }, select: { userId: true } },
      },
    },
  } satisfies Prisma.PostSaveSelect;
}

export type SavedPostRow = Prisma.PostSaveGetPayload<{
  select: ReturnType<typeof savedPostSelect>;
}>;

@Injectable()
export class PostSaveRepository {
  constructor(private readonly prisma: PrismaService) {}

  async save(userId: string, postId: string): Promise<SavePostResponse> {
    await this.prisma.postSave.createMany({
      data: [{ userId, postId }],
      skipDuplicates: true,
    });
    return { saved: true };
  }

  async unsave(userId: string, postId: string): Promise<UnsavePostResponse> {
    await this.prisma.postSave.deleteMany({ where: { userId, postId } });
    return { saved: false };
  }

  findSavedPage(
    userId: string,
    take: number,
    cursor?: SavedPostCursor,
  ): Promise<SavedPostRow[]> {
    return this.prisma.postSave.findMany({
      where: {
        userId,
        post: viewablePostWhere(userId),
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: cursor.savedAt } },
                { createdAt: cursor.savedAt, postId: { lt: cursor.postId } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { postId: 'desc' }],
      take,
      select: savedPostSelect(userId),
    });
  }
}
