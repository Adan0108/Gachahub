import { createHash, randomUUID } from 'node:crypto';
import { BadRequestException, GoneException, Injectable } from '@nestjs/common';
import type { PostType } from '../../generated/prisma/client';
import { RedisService } from '../../redis/redis.service';

export const FOR_YOU_MAX_RESULTS = 400;
export const FOR_YOU_CURRENT_POINTER_TTL_SECONDS = 3 * 60;
export const FOR_YOU_SNAPSHOT_TTL_SECONDS = 15 * 60;

export interface ForYouSnapshotFilters {
  type: PostType | null;
}

export interface ForYouSnapshot {
  id: string;
  userId: string;
  filterKey: string;
  postIds: string[];
  personalized: boolean;
}

interface ForYouSnapshotRanking {
  postIds: string[];
  personalized: boolean;
}

@Injectable()
export class ForYouSnapshotService {
  constructor(private readonly redis: RedisService) {}

  /**
   * Reuses this user's current filter-specific snapshot or lazily creates a
   * frozen personalized ranking with a longer continuation lifetime.
   */
  async getOrCreate(
    userId: string,
    filters: ForYouSnapshotFilters,
    createRanking: () => Promise<ForYouSnapshotRanking>,
  ): Promise<ForYouSnapshot> {
    const filterKey = this.createFilterKey(filters);
    const pointerKey = this.currentPointerKey(userId, filterKey);
    const currentId = await this.redis.get(pointerKey);

    if (currentId) {
      const current = await this.readSnapshot(currentId);

      if (current?.userId === userId && current.filterKey === filterKey) {
        return current;
      }

      await this.redis.delete(pointerKey);
    }

    const ranking = await createRanking();
    const snapshot: ForYouSnapshot = {
      id: randomUUID(),
      userId,
      filterKey,
      postIds: ranking.postIds.slice(0, FOR_YOU_MAX_RESULTS),
      personalized: ranking.personalized,
    };

    await this.redis.setJson(
      this.snapshotKey(snapshot.id),
      snapshot,
      FOR_YOU_SNAPSHOT_TTL_SECONDS,
    );
    await this.redis.set(
      pointerKey,
      snapshot.id,
      FOR_YOU_CURRENT_POINTER_TTL_SECONDS,
    );

    return snapshot;
  }

  /**
   * Loads an exact continuation snapshot and validates user ownership and the
   * effective request filters before exposing any personalized state.
   */
  async getForContinuation(
    snapshotId: string,
    userId: string,
    filters: ForYouSnapshotFilters,
  ): Promise<ForYouSnapshot> {
    const snapshot = await this.readSnapshot(snapshotId);

    if (!snapshot) {
      throw new GoneException(
        'For You snapshot expired; restart /feed/for-you without a cursor',
      );
    }

    if (snapshot.userId !== userId) {
      throw new BadRequestException('Invalid For You feed cursor');
    }

    if (snapshot.filterKey !== this.createFilterKey(filters)) {
      throw new BadRequestException(
        'For You cursor does not match the requested filters',
      );
    }

    return snapshot;
  }

  private createFilterKey(filters: ForYouSnapshotFilters): string {
    return createHash('sha256')
      .update(JSON.stringify(filters))
      .digest('base64url');
  }

  private currentPointerKey(userId: string, filterKey: string): string {
    return `feed:for-you:current:${userId}:${filterKey}`;
  }

  private snapshotKey(snapshotId: string): string {
    return `feed:for-you:snapshot:${snapshotId}`;
  }

  private readSnapshot(snapshotId: string): Promise<ForYouSnapshot | null> {
    return this.redis.getJson<ForYouSnapshot>(this.snapshotKey(snapshotId));
  }
}
