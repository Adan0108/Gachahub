import { createHash, randomUUID } from 'node:crypto';
import { BadRequestException, GoneException, Injectable } from '@nestjs/common';
import type { PostType } from '../../generated/prisma/client';
import { RedisService } from '../../redis/redis.service';

export const TRENDING_MAX_RESULTS = 200;
export const TRENDING_CANDIDATE_POOL = 500;
export const TRENDING_CURRENT_POINTER_TTL_SECONDS = 5 * 60;
export const TRENDING_SNAPSHOT_TTL_SECONDS = 15 * 60;

export interface TrendingSnapshotFilters {
  gameSlug: string | null;
  categorySlug: string | null;
  type: PostType | null;
}

export interface TrendingSnapshot {
  id: string;
  filterKey: string;
  postIds: string[];
}

@Injectable()
export class TrendingSnapshotService {
  constructor(private readonly redis: RedisService) {}

  /**
   * Reuses the short-lived current snapshot for these filters or creates one.
   *
   * The pointer expires before the snapshot so existing cursors can continue
   * after new first-page requests begin receiving a fresher ranking.
   */
  async getOrCreate(
    filters: TrendingSnapshotFilters,
    createPostIds: () => Promise<string[]>,
  ): Promise<TrendingSnapshot> {
    const filterKey = this.createFilterKey(filters);
    const pointerKey = this.currentPointerKey(filterKey);
    const currentId = await this.redis.get(pointerKey);

    if (currentId) {
      const current = await this.readSnapshot(currentId);

      if (current?.filterKey === filterKey) {
        return current;
      }

      await this.redis.delete(pointerKey);
    }

    const postIds = (await createPostIds()).slice(0, TRENDING_MAX_RESULTS);
    const snapshot: TrendingSnapshot = {
      id: randomUUID(),
      filterKey,
      postIds,
    };

    await this.redis.setJson(
      this.snapshotKey(snapshot.id),
      snapshot,
      TRENDING_SNAPSHOT_TTL_SECONDS,
    );
    await this.redis.set(
      pointerKey,
      snapshot.id,
      TRENDING_CURRENT_POINTER_TTL_SECONDS,
    );

    return snapshot;
  }

  /**
   * Loads a cursor snapshot and rejects expired or filter-mismatched requests.
   */
  async getForContinuation(
    snapshotId: string,
    filters: TrendingSnapshotFilters,
  ): Promise<TrendingSnapshot> {
    const snapshot = await this.readSnapshot(snapshotId);

    if (!snapshot) {
      throw new GoneException(
        'Trending snapshot expired; restart without a cursor',
      );
    }

    if (snapshot.filterKey !== this.createFilterKey(filters)) {
      throw new BadRequestException(
        'Trending cursor does not match the requested filters',
      );
    }

    return snapshot;
  }

  /**
   * Produces a stable, compact Redis-key component for effective filters.
   */
  private createFilterKey(filters: TrendingSnapshotFilters): string {
    return createHash('sha256')
      .update(JSON.stringify(filters))
      .digest('base64url');
  }

  /**
   * Returns the Redis key holding the current snapshot pointer for a filter.
   */
  private currentPointerKey(filterKey: string): string {
    return `feed:trending:current:${filterKey}`;
  }

  /**
   * Returns the Redis key holding one immutable ordered snapshot.
   */
  private snapshotKey(snapshotId: string): string {
    return `feed:trending:snapshot:${snapshotId}`;
  }

  /**
   * Reads one snapshot without extending its fixed continuation lifetime.
   */
  private readSnapshot(snapshotId: string): Promise<TrendingSnapshot | null> {
    return this.redis.getJson<TrendingSnapshot>(this.snapshotKey(snapshotId));
  }
}
