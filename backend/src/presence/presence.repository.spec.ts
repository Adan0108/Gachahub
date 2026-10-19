import { PresenceRepository } from './presence.repository';

describe('PresenceRepository', () => {
  const prisma = {
    chatParticipant: { findMany: jest.fn() },
    chatUserBlock: { findMany: jest.fn() },
  };
  let repository: PresenceRepository;

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.chatParticipant.findMany.mockResolvedValue([]);
    prisma.chatUserBlock.findMany.mockResolvedValue([]);
    repository = new PresenceRepository(prisma as never);
  });

  const sharing = (...ids: string[]) =>
    prisma.chatParticipant.findMany.mockResolvedValue(
      ids.map((userId) => ({ userId })),
    );

  describe('findAudienceIds', () => {
    it('is the people in an accepted chat with the person, ACTIVE on both sides', async () => {
      sharing('bo', 'cy');

      await expect(repository.findAudienceIds('me')).resolves.toEqual([
        'bo',
        'cy',
      ]);
      expect(prisma.chatParticipant.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId: { not: 'me' },
            state: 'ACTIVE',
            deletedAt: null,
            conversation: {
              participants: {
                some: { userId: 'me', state: 'ACTIVE', deletedAt: null },
              },
            },
          },
        }),
      );
    });

    it('leaves out anyone blocked either way', async () => {
      sharing('bo', 'cy', 'di');
      prisma.chatUserBlock.findMany.mockResolvedValue([
        { blockerId: 'me', blockedId: 'bo' },
        { blockerId: 'cy', blockedId: 'me' },
      ]);

      await expect(repository.findAudienceIds('me')).resolves.toEqual(['di']);
    });

    it('does not look for blocks when nobody shares a chat', async () => {
      await expect(repository.findAudienceIds('me')).resolves.toEqual([]);
      expect(prisma.chatUserBlock.findMany).not.toHaveBeenCalled();
    });
  });

  describe('findVisibleAmong', () => {
    it('only considers the people asked about', async () => {
      sharing('bo');

      const visible = await repository.findVisibleAmong('me', ['bo', 'zed']);

      expect([...visible]).toEqual(['bo']);
      const [query] = prisma.chatParticipant.findMany.mock.calls[0] as [
        { where: { userId: unknown } },
      ];
      expect(query.where.userId).toEqual({ in: ['bo', 'zed'], not: 'me' });
    });

    it('hides a person the viewer blocked, and one who blocked the viewer', async () => {
      sharing('bo', 'cy', 'di');
      prisma.chatUserBlock.findMany.mockResolvedValue([
        { blockerId: 'me', blockedId: 'bo' },
        { blockerId: 'cy', blockedId: 'me' },
      ]);

      const visible = await repository.findVisibleAmong('me', [
        'bo',
        'cy',
        'di',
      ]);

      expect([...visible]).toEqual(['di']);
    });

    it('asks nothing for an empty list', async () => {
      await expect(repository.findVisibleAmong('me', [])).resolves.toEqual(
        new Set(),
      );
      expect(prisma.chatParticipant.findMany).not.toHaveBeenCalled();
    });
  });
});
