import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { MlsHandshakesRepository } from './mls-handshakes.repository';

/**
 * Unlike other repositories in this codebase, acceptHandshake's membership
 * authorization gate (threat-model §3: an MLS commit can never be the thing
 * that first grants conversation membership) is security-sensitive enough
 * to warrant its own direct test, mocking $transaction rather than relying
 * on the service layer to exercise it indirectly.
 */
describe('MlsHandshakesRepository.acceptHandshake', () => {
  function buildTx() {
    return {
      chatConversation: { updateMany: jest.fn() },
      chatDevice: { findMany: jest.fn().mockResolvedValue([]) },
      chatParticipant: { findMany: jest.fn().mockResolvedValue([]) },
      mlsHandshake: { create: jest.fn() },
      mlsWelcome: { createMany: jest.fn() },
    };
  }

  function buildPrismaMock() {
    const tx = buildTx();
    const prisma = {
      $transaction: jest.fn(
        (callback: (tx: ReturnType<typeof buildTx>) => unknown) => callback(tx),
      ),
      mlsHandshake: { findUnique: jest.fn() },
    };
    return { prisma, tx };
  }

  const baseParams = {
    conversationId: 'conv-1',
    expectedEpoch: 0,
    senderDeviceId: 'device-1',
    payload: new Uint8Array([1, 2, 3]),
    payloadSha256: 'hash-1',
    welcomes: [] as { recipientDeviceId: string; payload: Uint8Array }[],
  };

  it('accepts a commit with no welcomes when the epoch CAS wins', async () => {
    const { prisma, tx } = buildPrismaMock();
    tx.chatConversation.updateMany.mockResolvedValue({ count: 1 });
    tx.mlsHandshake.create.mockResolvedValue({
      id: 'hs-1',
      ...baseParams,
      createdAt: new Date(),
    });

    const repository = new MlsHandshakesRepository(prisma as any);
    const result = await repository.acceptHandshake(baseParams);

    expect(result.outcome).toBe('accepted');
    expect(tx.mlsWelcome.createMany).not.toHaveBeenCalled();
  });

  it('rejects a welcome addressed to an unknown device, without creating a handshake', async () => {
    const { prisma, tx } = buildPrismaMock();
    tx.chatConversation.updateMany.mockResolvedValue({ count: 1 });
    tx.chatDevice.findMany.mockResolvedValue([]);

    const repository = new MlsHandshakesRepository(prisma as any);

    await expect(
      repository.acceptHandshake({
        ...baseParams,
        welcomes: [
          { recipientDeviceId: 'unknown-device', payload: new Uint8Array() },
        ],
      }),
    ).rejects.toThrow(BadRequestException);

    expect(tx.mlsHandshake.create).not.toHaveBeenCalled();
  });

  it('rejects a welcome for a user with no participant row at all', async () => {
    const { prisma, tx } = buildPrismaMock();
    tx.chatConversation.updateMany.mockResolvedValue({ count: 1 });
    tx.chatDevice.findMany.mockResolvedValue([
      { id: 'device-2', userId: 'user-2', revokedAt: null },
    ]);
    tx.chatParticipant.findMany.mockResolvedValue([]);

    const repository = new MlsHandshakesRepository(prisma as any);

    await expect(
      repository.acceptHandshake({
        ...baseParams,
        welcomes: [
          { recipientDeviceId: 'device-2', payload: new Uint8Array() },
        ],
      }),
    ).rejects.toThrow(ForbiddenException);

    expect(tx.mlsHandshake.create).not.toHaveBeenCalled();
  });

  it('rejects a welcome for a user who is only PENDING, not yet ACTIVE', async () => {
    const { prisma, tx } = buildPrismaMock();
    tx.chatConversation.updateMany.mockResolvedValue({ count: 1 });
    tx.chatDevice.findMany.mockResolvedValue([
      { id: 'device-2', userId: 'user-2', revokedAt: null },
    ]);
    tx.chatParticipant.findMany.mockResolvedValue([
      { userId: 'user-2', state: 'PENDING' },
    ]);

    const repository = new MlsHandshakesRepository(prisma as any);

    await expect(
      repository.acceptHandshake({
        ...baseParams,
        welcomes: [
          { recipientDeviceId: 'device-2', payload: new Uint8Array() },
        ],
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects a welcome for a user who has blocked/declined/left the conversation', async () => {
    const { prisma, tx } = buildPrismaMock();
    tx.chatConversation.updateMany.mockResolvedValue({ count: 1 });
    tx.chatDevice.findMany.mockResolvedValue([
      { id: 'device-2', userId: 'user-2', revokedAt: null },
    ]);
    tx.chatParticipant.findMany.mockResolvedValue([
      { userId: 'user-2', state: 'BLOCKED' },
    ]);

    const repository = new MlsHandshakesRepository(prisma as any);

    await expect(
      repository.acceptHandshake({
        ...baseParams,
        welcomes: [
          { recipientDeviceId: 'device-2', payload: new Uint8Array() },
        ],
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects a welcome addressed to a revoked device, even if its user is active', async () => {
    const { prisma, tx } = buildPrismaMock();
    tx.chatConversation.updateMany.mockResolvedValue({ count: 1 });
    tx.chatDevice.findMany.mockResolvedValue([
      { id: 'device-2', userId: 'user-2', revokedAt: new Date() },
    ]);

    const repository = new MlsHandshakesRepository(prisma as any);

    await expect(
      repository.acceptHandshake({
        ...baseParams,
        welcomes: [
          { recipientDeviceId: 'device-2', payload: new Uint8Array() },
        ],
      }),
    ).rejects.toThrow(BadRequestException);

    expect(tx.mlsHandshake.create).not.toHaveBeenCalled();
  });

  it('accepts a welcome for a user who is an active participant', async () => {
    const { prisma, tx } = buildPrismaMock();
    tx.chatConversation.updateMany.mockResolvedValue({ count: 1 });
    tx.chatDevice.findMany.mockResolvedValue([
      { id: 'device-2', userId: 'user-2', revokedAt: null },
    ]);
    tx.chatParticipant.findMany.mockResolvedValue([
      { userId: 'user-2', state: 'ACTIVE' },
    ]);
    tx.mlsHandshake.create.mockResolvedValue({
      id: 'hs-1',
      ...baseParams,
      createdAt: new Date(),
    });

    const repository = new MlsHandshakesRepository(prisma as any);
    const result = await repository.acceptHandshake({
      ...baseParams,
      welcomes: [
        { recipientDeviceId: 'device-2', payload: new Uint8Array([9]) },
      ],
    });

    expect(result.outcome).toBe('accepted');
    expect(tx.mlsWelcome.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [expect.objectContaining({ recipientDeviceId: 'device-2' })],
      }),
    );
  });

  it('reports a duplicate when the epoch CAS loses to an identical retry', async () => {
    const { prisma, tx } = buildPrismaMock();
    tx.chatConversation.updateMany.mockResolvedValue({ count: 0 });
    prisma.mlsHandshake.findUnique.mockResolvedValue({
      id: 'hs-winner',
      payloadSha256: baseParams.payloadSha256,
    });

    const repository = new MlsHandshakesRepository(prisma as any);
    const result = await repository.acceptHandshake(baseParams);

    expect(result.outcome).toBe('duplicate');
  });

  it('reports a conflict when the epoch CAS loses to a different commit', async () => {
    const { prisma, tx } = buildPrismaMock();
    tx.chatConversation.updateMany.mockResolvedValue({ count: 0 });
    prisma.mlsHandshake.findUnique.mockResolvedValue({
      id: 'hs-winner',
      payloadSha256: 'some-other-hash',
    });

    const repository = new MlsHandshakesRepository(prisma as any);
    const result = await repository.acceptHandshake(baseParams);

    expect(result.outcome).toBe('conflict');
  });
});
