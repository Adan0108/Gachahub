import { BadRequestException, GoneException } from '@nestjs/common';
import {
  FOR_YOU_CURRENT_POINTER_TTL_SECONDS,
  FOR_YOU_MAX_RESULTS,
  FOR_YOU_SNAPSHOT_TTL_SECONDS,
  ForYouSnapshotService,
  type ForYouSnapshotFilters,
} from './for-you-snapshot.service';

describe('ForYouSnapshotService', () => {
  const redis = {
    get: jest.fn(),
    set: jest.fn(),
    delete: jest.fn(),
    setJson: jest.fn(),
    getJson: jest.fn(),
  };
  const filters: ForYouSnapshotFilters = { type: null };
  let service: ForYouSnapshotService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ForYouSnapshotService(redis as never);
    redis.get.mockResolvedValue(null);
    redis.getJson.mockResolvedValue(null);
    redis.set.mockResolvedValue(undefined);
    redis.setJson.mockResolvedValue(undefined);
    redis.delete.mockResolvedValue(undefined);
  });

  it('stores at most 400 IDs with separate pointer and snapshot TTLs', async () => {
    const ids = Array.from(
      { length: FOR_YOU_MAX_RESULTS + 25 },
      (_, index) => `post-${index + 1}`,
    );
    const snapshot = await service.getOrCreate('user-1', filters, () =>
      Promise.resolve({ postIds: ids, personalized: true }),
    );

    expect(snapshot.postIds).toEqual(ids.slice(0, FOR_YOU_MAX_RESULTS));
    expect(redis.setJson).toHaveBeenCalledWith(
      `feed:for-you:snapshot:${snapshot.id}`,
      snapshot,
      FOR_YOU_SNAPSHOT_TTL_SECONDS,
    );
    expect(redis.set).toHaveBeenCalledWith(
      expect.stringMatching(/^feed:for-you:current:user-1:/),
      snapshot.id,
      FOR_YOU_CURRENT_POINTER_TTL_SECONDS,
    );
  });

  it('reuses the current snapshot for the same user and filters', async () => {
    const current = await service.getOrCreate('user-1', filters, () =>
      Promise.resolve({ postIds: ['post-1'], personalized: true }),
    );
    const createRanking = jest.fn();
    redis.get.mockResolvedValue(current.id);
    redis.getJson.mockResolvedValue(current);

    await expect(
      service.getOrCreate('user-1', filters, createRanking),
    ).resolves.toBe(current);
    expect(createRanking).not.toHaveBeenCalled();
  });

  it('creates a new snapshot after the current pointer expires', async () => {
    const first = await service.getOrCreate('user-1', filters, () =>
      Promise.resolve({ postIds: ['old'], personalized: true }),
    );
    redis.get.mockResolvedValue(null);
    const second = await service.getOrCreate('user-1', filters, () =>
      Promise.resolve({ postIds: ['new'], personalized: true }),
    );

    expect(second.id).not.toBe(first.id);
    expect(second.postIds).toEqual(['new']);
  });

  it('keeps an old snapshot available for continuation', async () => {
    const snapshot = await service.getOrCreate('user-1', filters, () =>
      Promise.resolve({ postIds: ['post-1'], personalized: false }),
    );
    redis.getJson.mockResolvedValue(snapshot);

    await expect(
      service.getForContinuation(snapshot.id, 'user-1', filters),
    ).resolves.toBe(snapshot);
  });

  it('isolates current snapshots by user and filter', async () => {
    await service.getOrCreate('user-1', filters, () =>
      Promise.resolve({ postIds: [], personalized: true }),
    );
    await service.getOrCreate('user-2', filters, () =>
      Promise.resolve({ postIds: [], personalized: true }),
    );
    await service.getOrCreate('user-1', { type: 'GUIDE' }, () =>
      Promise.resolve({ postIds: [], personalized: true }),
    );

    const keys = (redis.set.mock.calls as Array<[string]>).map(([key]) => key);
    expect(new Set(keys).size).toBe(3);
  });

  it('returns 410 when the continuation snapshot expired', async () => {
    await expect(
      service.getForContinuation(
        '123e4567-e89b-42d3-a456-426614174000',
        'user-1',
        filters,
      ),
    ).rejects.toBeInstanceOf(GoneException);
  });

  it('rejects use by another user without exposing snapshot details', async () => {
    const snapshot = await service.getOrCreate('user-1', filters, () =>
      Promise.resolve({ postIds: [], personalized: true }),
    );
    redis.getJson.mockResolvedValue(snapshot);

    await expect(
      service.getForContinuation(snapshot.id, 'user-2', filters),
    ).rejects.toEqual(
      expect.objectContaining({
        constructor: BadRequestException,
        message: 'Invalid For You feed cursor',
      }),
    );
  });

  it('rejects continuation with different filters', async () => {
    const snapshot = await service.getOrCreate('user-1', filters, () =>
      Promise.resolve({ postIds: [], personalized: true }),
    );
    redis.getJson.mockResolvedValue(snapshot);

    await expect(
      service.getForContinuation(snapshot.id, 'user-1', { type: 'GUIDE' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
