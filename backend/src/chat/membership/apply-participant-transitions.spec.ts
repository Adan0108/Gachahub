import { ConflictException } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import {
  applyParticipantTransitions,
  roundChange,
} from './apply-participant-transitions';

describe('applyParticipantTransitions', () => {
  const tx = {
    chatParticipant: {
      createMany: jest.fn(),
      updateMany: jest.fn(),
    },
    chatMembershipRound: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
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
    tx.chatMembershipRound.findFirst.mockResolvedValue(null);
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

  it('starts fresh when someone still being removed is invited again', async () => {
    await apply([{ userId: 'u2', from: 'LEAVING', to: 'PENDING' }]);

    expect(tx.chatParticipant.updateMany).toHaveBeenCalledWith({
      where: { conversationId: 'conv-1', userId: 'u2', state: 'LEAVING' },
      data: {
        state: 'PENDING',
        pendingSince: expect.any(Date),
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

  it('stamps pendingSince when a new row starts PENDING', async () => {
    await apply([{ userId: 'u2', from: null, to: 'PENDING' }]);

    expect(tx.chatParticipant.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ pendingSince: expect.any(Date) as Date }),
      ],
      skipDuplicates: true,
    });
  });

  it('stamps pendingSince when an existing row re-enters PENDING', async () => {
    await apply([{ userId: 'u2', from: 'DECLINED', to: 'PENDING' }]);

    const [args] = tx.chatParticipant.updateMany.mock.calls[0] as [
      { data: { pendingSince: unknown } },
    ];
    expect(args.data.pendingSince).toBeInstanceOf(Date);
  });

  it('clears pendingSince when leaving PENDING', async () => {
    await apply([{ userId: 'u2', from: 'PENDING', to: 'LEAVING' }]);

    expect(tx.chatParticipant.updateMany).toHaveBeenCalledWith({
      where: { conversationId: 'conv-1', userId: 'u2', state: 'PENDING' },
      data: { state: 'LEAVING', pendingSince: null },
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

  it('starts a round for an invite, and finishes it when they accept', async () => {
    await apply([{ userId: 'u2', from: null, to: 'PENDING' }]);
    expect(tx.chatMembershipRound.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        conversationId: 'conv-1',
        userId: 'u2',
        invitedAt: expect.any(Date) as Date,
      }) as object,
    });

    tx.chatMembershipRound.findFirst.mockResolvedValue({
      id: 'round-1',
      invitedAt: new Date(),
      joinedAt: null,
    });
    await apply([{ userId: 'u2', from: 'PENDING', to: 'JOINING' }]);
    expect(tx.chatMembershipRound.update).toHaveBeenCalledWith({
      where: { id: 'round-1' },
      data: { joinedAt: expect.any(Date) as Date },
    });
  });

  it('starts a joined round for a direct add, and none for a leave', async () => {
    await apply([
      { userId: 'u2', from: 'DECLINED', to: 'JOINING' },
      { userId: 'u3', from: 'ACTIVE', to: 'LEAVING' },
    ]);

    expect(tx.chatMembershipRound.create).toHaveBeenCalledTimes(1);
    expect(tx.chatMembershipRound.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'u2',
        joinedAt: expect.any(Date) as Date,
      }) as object,
    });
  });

  it('does nothing for an empty change list', async () => {
    await expect(apply([])).resolves.toBe(0);

    expect(tx.chatParticipant.updateMany).not.toHaveBeenCalled();
    expect(tx.chatParticipant.createMany).not.toHaveBeenCalled();
  });
});

// What a chat says about someone: "invited" at the invite, "joined" at the accept, nothing for a decline.
describe('roundChange', () => {
  it.each([
    [null, 'PENDING', 'invite'],
    ['DECLINED', 'PENDING', 'invite'],
    ['PENDING', 'JOINING', 'accept'],
    [null, 'ACTIVE', 'join'],
    ['DECLINED', 'JOINING', 'join'],
    ['PENDING', 'PENDING', null],
    ['PENDING', 'LEAVING', null],
    ['PENDING', 'DECLINED', null],
    ['JOINING', 'ACTIVE', null],
    ['LEAVING', 'ACTIVE', null],
    ['ARCHIVED', 'ACTIVE', null],
  ] as const)('%s to %s is %s', (from, to, expected) => {
    expect(roundChange(from, to)).toBe(expected);
  });
});
