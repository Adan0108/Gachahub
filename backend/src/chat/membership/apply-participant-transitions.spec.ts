import { ConflictException } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import { applyParticipantTransitions } from './apply-participant-transitions';

describe('applyParticipantTransitions', () => {
  const tx = {
    chatParticipant: {
      createMany: jest.fn(),
      updateMany: jest.fn(),
    },
  };

  const apply = (changes: Parameters<typeof applyParticipantTransitions>[2]) =>
    applyParticipantTransitions(
      tx as unknown as Prisma.TransactionClient,
      'conv-1',
      changes,
    );

  beforeEach(() => {
    jest.clearAllMocks();
    tx.chatParticipant.createMany.mockResolvedValue({ count: 1 });
    tx.chatParticipant.updateMany.mockResolvedValue({ count: 1 });
  });

  it('updates a member only if they are still in the state the caller read', async () => {
    await apply([{ userId: 'u2', from: 'ACTIVE', to: 'LEAVING' }]);

    expect(tx.chatParticipant.updateMany).toHaveBeenCalledWith({
      where: { conversationId: 'conv-1', userId: 'u2', state: 'ACTIVE' },
      data: { state: 'LEAVING' },
    });
  });

  it('creates a row for someone with none', async () => {
    await apply([{ userId: 'u2', from: null, to: 'JOINING' }]);

    expect(tx.chatParticipant.createMany).toHaveBeenCalledWith({
      data: [
        {
          conversationId: 'conv-1',
          userId: 'u2',
          role: 'MEMBER',
          state: 'JOINING',
        },
      ],
      skipDuplicates: true,
    });
  });

  it('starts fresh when someone comes back from DECLINED', async () => {
    await apply([{ userId: 'u2', from: 'DECLINED', to: 'JOINING' }]);

    expect(tx.chatParticipant.updateMany).toHaveBeenCalledWith({
      where: { conversationId: 'conv-1', userId: 'u2', state: 'DECLINED' },
      data: {
        state: 'JOINING',
        role: 'MEMBER',
        deletedAt: null,
        archivedAt: null,
      },
    });
  });

  it('keeps a member’s role when a pending removal is cancelled', async () => {
    await apply([{ userId: 'u2', from: 'LEAVING', to: 'ACTIVE' }]);

    expect(tx.chatParticipant.updateMany).toHaveBeenCalledWith({
      where: { conversationId: 'conv-1', userId: 'u2', state: 'LEAVING' },
      data: { state: 'ACTIVE' },
    });
  });

  it('returns how many changes it applied', async () => {
    await expect(
      apply([
        { userId: 'u2', from: 'ACTIVE', to: 'LEAVING' },
        { userId: 'u3', from: null, to: 'PENDING' },
      ]),
    ).resolves.toBe(2);
  });

  it('throws Conflict when someone changed since it was read, so the caller’s transaction rolls back', async () => {
    tx.chatParticipant.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    await expect(
      apply([
        { userId: 'u2', from: 'ACTIVE', to: 'LEAVING' },
        { userId: 'u3', from: 'ACTIVE', to: 'LEAVING' },
      ]),
    ).rejects.toThrow(ConflictException);
  });

  it('throws Conflict when a row someone expected not to exist was created meanwhile', async () => {
    tx.chatParticipant.createMany.mockResolvedValue({ count: 0 });

    await expect(
      apply([{ userId: 'u2', from: null, to: 'JOINING' }]),
    ).rejects.toThrow(ConflictException);
  });

  it('does nothing for an empty change list', async () => {
    await expect(apply([])).resolves.toBe(0);

    expect(tx.chatParticipant.updateMany).not.toHaveBeenCalled();
    expect(tx.chatParticipant.createMany).not.toHaveBeenCalled();
  });
});
