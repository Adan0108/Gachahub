jest.mock('../prisma/prisma.service', () => ({ PrismaService: class {} }));

import type { PrismaService } from '../prisma/prisma.service';
import { MlsAuditRepository } from './mls-audit.repository';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('MlsAuditRepository', () => {
  const db = {
    $queryRaw: jest.fn(),
    chatParticipant: { findMany: jest.fn() },
  };
  let repository: MlsAuditRepository;

  beforeEach(() => {
    jest.resetAllMocks();
    repository = new MlsAuditRepository(db as unknown as PrismaService);
  });

  it('finds leaves of dead devices, giving retired ones a week of grace', async () => {
    const leaves = [{ conversationId: 'c', deviceId: 'd', userId: 'u' }];
    db.$queryRaw.mockResolvedValue(leaves);

    await expect(repository.findLeavesOfDeadDevices()).resolves.toBe(leaves);

    const values = (db.$queryRaw.mock.calls[0] as unknown[]).slice(1);
    const cutoff = values.find((v) => v instanceof Date) as Date;
    expect(Math.round((Date.now() - cutoff.getTime()) / DAY_MS)).toBe(7);
  });

  it('treats a LEAVING owner as expected, not as an outsider', async () => {
    db.$queryRaw.mockResolvedValue([]);

    await repository.findLeavesOfOutsiders();

    const bound = JSON.stringify(
      (db.$queryRaw.mock.calls[0] as unknown[]).slice(1),
    );
    expect(bound).toContain('LEAVING');
    expect(bound).toContain('ACTIVE');
    expect(bound).not.toContain('DECLINED');
  });

  it('flags removals stuck for a day and joins stuck for a week', async () => {
    db.chatParticipant.findMany.mockResolvedValue([
      { conversationId: 'c', userId: 'u', state: 'LEAVING' },
    ]);

    const stuck = await repository.findStuckParticipants();

    expect(stuck).toEqual([
      { conversationId: 'c', userId: 'u', state: 'LEAVING' },
    ]);
    const [{ where }] = db.chatParticipant.findMany.mock.calls[0] as [
      { where: { OR: Array<{ state: string; updatedAt: { lt: Date } }> } },
    ];
    const ageDays = (clause: { updatedAt: { lt: Date } }) =>
      Math.round((Date.now() - clause.updatedAt.lt.getTime()) / DAY_MS);
    expect(where.OR.map((c) => [c.state, ageDays(c)])).toEqual([
      ['LEAVING', 1],
      ['JOINING', 7],
    ]);
  });
});
