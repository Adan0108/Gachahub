jest.mock('../auth/auth', () => ({ auth: {} }));
jest.mock('@thallesp/nestjs-better-auth', () => ({
  Session: () => () => undefined,
}));
jest.mock('../prisma/prisma.service', () => ({ PrismaService: class {} }));

import 'reflect-metadata';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import type { PrismaService } from '../prisma/prisma.service';
import { ChatDevicesController } from './chat-devices.controller';
import { ChatDevicesRepository } from './chat-devices.repository';
import { ChatDevicesService } from './chat-devices.service';

const DAY = 24 * 60 * 60 * 1000;

describe('chat device listing', () => {
  afterEach(() => jest.useRealTimers());

  it('repository scopes to the caller, keeps recent revoked, sorts newest first, selects no key material', async () => {
    const prisma = { chatDevice: { findMany: jest.fn() } };
    const repository = new ChatDevicesRepository(
      prisma as unknown as PrismaService,
    );
    const since = new Date('2026-01-01');

    await repository.listOwnDevices('u1', since);

    expect(prisma.chatDevice.findMany).toHaveBeenCalledWith({
      where: {
        userId: 'u1',
        OR: [{ revokedAt: null }, { revokedAt: { gte: since } }],
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        ciphersuite: true,
        createdAt: true,
        lastSeenAt: true,
        revokedAt: true,
      },
    });
  });

  it('service maps dates to ISO strings and uses a 30 day revoked window', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-30T00:00:00Z'));
    const repository = {
      listOwnDevices: jest.fn().mockResolvedValue([
        {
          id: 'd1',
          ciphersuite: 'cs',
          createdAt: new Date('2026-06-01T00:00:00Z'),
          lastSeenAt: new Date('2026-06-02T00:00:00Z'),
          revokedAt: null,
        },
        {
          id: 'd2',
          ciphersuite: 'cs',
          createdAt: new Date('2026-05-01T00:00:00Z'),
          lastSeenAt: new Date('2026-05-02T00:00:00Z'),
          revokedAt: new Date('2026-06-10T00:00:00Z'),
        },
      ]),
    };
    const service = new ChatDevicesService(
      repository as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    const result = await service.listOwnDevices('u1');

    expect(repository.listOwnDevices).toHaveBeenCalledWith(
      'u1',
      new Date(Date.now() - 30 * DAY),
    );
    expect(result).toEqual({
      items: [
        {
          id: 'd1',
          ciphersuite: 'cs',
          createdAt: '2026-06-01T00:00:00.000Z',
          lastSeenAt: '2026-06-02T00:00:00.000Z',
          revokedAt: null,
        },
        {
          id: 'd2',
          ciphersuite: 'cs',
          createdAt: '2026-05-01T00:00:00.000Z',
          lastSeenAt: '2026-05-02T00:00:00.000Z',
          revokedAt: '2026-06-10T00:00:00.000Z',
        },
      ],
    });
  });

  it('controller lists for the session user', () => {
    const service = { listOwnDevices: jest.fn().mockReturnValue('r') };
    const controller = new ChatDevicesController(service as any);

    const out = controller.listDevices({ user: { id: 'u1' } } as UserSession);

    expect(out).toBe('r');
    expect(service.listOwnDevices).toHaveBeenCalledWith('u1');
  });
});
