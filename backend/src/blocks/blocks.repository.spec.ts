import { BlocksRepository } from './blocks.repository';

describe('BlocksRepository', () => {
  const prisma = {
    $transaction: jest.fn(),
    chatUserBlock: { upsert: jest.fn() },
    userFollow: { deleteMany: jest.fn() },
  };
  let repository: BlocksRepository;

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.chatUserBlock.upsert.mockReturnValue('upsert');
    prisma.userFollow.deleteMany.mockReturnValue('deleteMany');
    prisma.$transaction.mockResolvedValue([
      { blockerId: 'me', blockedId: 'bo' },
    ]);
    repository = new BlocksRepository(prisma as never);
  });

  it('blocks and ends the follows between the two, either way, in one transaction', async () => {
    const block = await repository.create('me', 'bo');

    expect(prisma.userFollow.deleteMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { followerId: 'me', followingId: 'bo' },
          { followerId: 'bo', followingId: 'me' },
        ],
      },
    });
    expect(prisma.$transaction).toHaveBeenCalledWith(['upsert', 'deleteMany']);
    expect(block).toEqual({ blockerId: 'me', blockedId: 'bo' });
  });
});
