import type { PrismaService } from '../prisma/prisma.service';

jest.mock('../prisma/prisma.service', () => ({ PrismaService: class {} }));

import { ParticipantStateRepository } from './participant-state.repository';

describe('ParticipantStateRepository', () => {
  const prisma = { chatParticipant: { findMany: jest.fn() } };
  let repository: ParticipantStateRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    repository = new ParticipantStateRepository(
      prisma as unknown as PrismaService,
    );
  });

  it('maps each found user to their state and leaves out users without a row', async () => {
    prisma.chatParticipant.findMany.mockResolvedValue([
      { userId: 'u1', state: 'ACTIVE' },
      { userId: 'u2', state: 'PENDING' },
    ]);

    const states = await repository.findStates('conv-1', ['u1', 'u2', 'u3']);

    expect(states).toEqual(
      new Map([
        ['u1', 'ACTIVE'],
        ['u2', 'PENDING'],
      ]),
    );
    expect(prisma.chatParticipant.findMany).toHaveBeenCalledWith({
      where: { conversationId: 'conv-1', userId: { in: ['u1', 'u2', 'u3'] } },
      select: { userId: true, state: true },
    });
  });

  it('reads one user, or undefined without a participant row', async () => {
    prisma.chatParticipant.findMany.mockResolvedValueOnce([
      { userId: 'u1', state: 'ARCHIVED' },
    ]);
    prisma.chatParticipant.findMany.mockResolvedValueOnce([]);

    await expect(repository.findState('conv-1', 'u1')).resolves.toBe(
      'ARCHIVED',
    );
    await expect(repository.findState('conv-1', 'u1')).resolves.toBeUndefined();
  });
});
