import { BadRequestException, GoneException } from '@nestjs/common';
import {
  TRENDING_CURRENT_POINTER_TTL_SECONDS,
  TRENDING_MAX_RESULTS,
  TRENDING_SNAPSHOT_TTL_SECONDS,
  TrendingSnapshotService,
  type TrendingSnapshotFilters,
} from './trending-snapshot.service';

describe('TrendingSnapshotService', () => {
  const redis = {
    get: jest.fn(),
    set: jest.fn(),
    delete: jest.fn(),
    setJson: jest.fn(),
    getJson: jest.fn(),
  };
  const filters: TrendingSnapshotFilters = {
    gameSlug: null,
    categorySlug: null,
    type: null,
  };
  let service: TrendingSnapshotService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new TrendingSnapshotService(redis as never);
    redis.get.mockResolvedValue(null);
    redis.getJson.mockResolvedValue(null);
    redis.set.mockResolvedValue(undefined);
    redis.setJson.mockResolvedValue(undefined);
    redis.delete.mockResolvedValue(undefined);
  });

  it('stores at most 200 ordered IDs with separate pointer and snapshot TTLs', async () => {
    const ids = Array.from(
      { length: TRENDING_MAX_RESULTS + 25 },
      (_, index) => `post-${index + 1}`,
    );

    const snapshot = await service.getOrCreate(filters, () =>
      Promise.resolve(ids),
    );

    expect(snapshot.postIds).toEqual(ids.slice(0, TRENDING_MAX_RESULTS));
    expect(redis.setJson).toHaveBeenCalledWith(
      `feed:trending:snapshot:${snapshot.id}`,
      snapshot,
      TRENDING_SNAPSHOT_TTL_SECONDS,
    );
    expect(redis.set).toHaveBeenCalledWith(
      expect.stringMatching(/^feed:trending:current:/),
      snapshot.id,
      TRENDING_CURRENT_POINTER_TTL_SECONDS,
    );
  });

  it('reuses the current snapshot without rebuilding its ranking', async () => {
    const current = await service.getOrCreate(filters, () =>
      Promise.resolve(['post-1']),
    );
    const createPostIds = jest.fn().mockResolvedValue(['post-new']);
    redis.get.mockResolvedValue(current.id);
    redis.getJson.mockResolvedValue(current);
    redis.setJson.mockClear();

    await expect(service.getOrCreate(filters, createPostIds)).resolves.toBe(
      current,
    );
    expect(createPostIds).not.toHaveBeenCalled();
    expect(redis.setJson).not.toHaveBeenCalled();
  });

  it('returns 410 when a continuation snapshot has expired', async () => {
    await expect(
      service.getForContinuation(
        '123e4567-e89b-42d3-a456-426614174000',
        filters,
      ),
    ).rejects.toBeInstanceOf(GoneException);
  });

  it('rejects a cursor reused with different effective filters', async () => {
    const snapshot = await service.getOrCreate(filters, () =>
      Promise.resolve(['post-1']),
    );
    redis.getJson.mockResolvedValue(snapshot);

    await expect(
      service.getForContinuation(snapshot.id, {
        ...filters,
        gameSlug: 'genshin-impact',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('creates a fresh snapshot with new ranking data after the pointer is gone', async () => {
    const first = await service.getOrCreate(filters, () =>
      Promise.resolve(['post-old']),
    );
    redis.get.mockResolvedValue(null);

    const second = await service.getOrCreate(filters, () =>
      Promise.resolve(['post-new', 'post-old']),
    );

    expect(second.id).not.toBe(first.id);
    expect(second.postIds).toEqual(['post-new', 'post-old']);
  });

  it('uses different current pointers for different filter combinations', async () => {
    await service.getOrCreate(filters, () => Promise.resolve([]));
    await service.getOrCreate(
      {
        ...filters,
        type: 'GUIDE',
      },
      () => Promise.resolve([]),
    );

    const pointerCalls = redis.set.mock.calls as Array<
      [string, string, number]
    >;
    const pointerKeys = pointerCalls.map((call) => call[0]);

    expect(new Set(pointerKeys).size).toBe(2);
  });

  it('propagates Redis failures instead of serving an unstable fallback', async () => {
    redis.get.mockRejectedValue(new Error('redis unavailable'));

    await expect(
      service.getOrCreate(filters, () => Promise.resolve(['post-1'])),
    ).rejects.toThrow('redis unavailable');
  });
});
