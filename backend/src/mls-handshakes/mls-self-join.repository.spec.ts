jest.mock('../prisma/prisma.service', () => ({ PrismaService: class {} }));

import type { PrismaService } from '../prisma/prisma.service';
import { MlsSelfJoinRepository } from './mls-self-join.repository';

describe('MlsSelfJoinRepository', () => {
  const db = { $queryRaw: jest.fn() };
  let repository: MlsSelfJoinRepository;

  beforeEach(() => {
    jest.resetAllMocks();
    repository = new MlsSelfJoinRepository(db as unknown as PrismaService);
  });

  function boundValues(): unknown[] {
    return (db.$queryRaw.mock.calls[0] as unknown[]).slice(1);
  }

  it('returns the ids of joinable conversations', async () => {
    db.$queryRaw.mockResolvedValue([{ id: 'c1' }, { id: 'c2' }]);

    await expect(
      repository.findJoinableConversationIds({
        userId: 'u1',
        deviceId: 'd1',
        scope: 'full',
        limit: 10,
      }),
    ).resolves.toEqual(['c1', 'c2']);
  });

  it('the pending scope only looks at JOINING participants', async () => {
    db.$queryRaw.mockResolvedValue([]);

    await repository.findJoinableConversationIds({
      userId: 'u1',
      deviceId: 'd1',
      scope: 'pending',
      limit: 5,
    });

    const bound = JSON.stringify(boundValues());
    expect(bound).toContain('JOINING');
    expect(bound).not.toContain('ACTIVE');
  });

  it('the full scope covers every state entitled to a leaf', async () => {
    db.$queryRaw.mockResolvedValue([]);

    await repository.findJoinableConversationIds({
      userId: 'u1',
      deviceId: 'd1',
      scope: 'full',
      limit: 5,
    });

    const bound = JSON.stringify(boundValues());
    for (const state of ['PENDING', 'JOINING', 'ACTIVE', 'ARCHIVED']) {
      expect(bound).toContain(state);
    }
  });
});
