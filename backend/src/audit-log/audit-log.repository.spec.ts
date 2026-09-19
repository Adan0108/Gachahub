import type { PrismaService } from '../prisma/prisma.service';

jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class {},
}));

import { AuditLogRepository } from './audit-log.repository';

describe('AuditLogRepository.create', () => {
  const makeDb = () => ({
    user: { findUnique: jest.fn().mockResolvedValue({ name: 'Mod One' }) },
    game: {
      findUnique: jest.fn().mockResolvedValue({ slug: 'wuthering-waves' }),
    },
    auditLog: { create: jest.fn().mockResolvedValue({ id: 'log-1' }) },
  });

  const entry = {
    action: 'POST_HIDDEN',
    actorId: 'mod-1',
    targetType: 'POST',
    targetId: 'post-1',
    gameId: 'game-1',
    metadata: { authorId: 'author-1', postTitle: 'A post' },
  } as const;

  it('looks up the actor name and game slug when the caller omits them', async () => {
    const db = makeDb();
    const repository = new AuditLogRepository(db as unknown as PrismaService);

    await repository.create(entry);

    expect(db.auditLog.create).toHaveBeenCalledWith({
      data: { ...entry, actorName: 'Mod One', gameSlug: 'wuthering-waves' },
    });
  });

  it('skips the game lookup for a platform-level entry', async () => {
    const db = makeDb();
    const repository = new AuditLogRepository(db as unknown as PrismaService);
    const platformEntry = { ...entry, gameId: undefined };

    await repository.create(platformEntry);

    expect(db.game.findUnique).not.toHaveBeenCalled();
    expect(db.auditLog.create).toHaveBeenCalledWith({
      data: { ...platformEntry, actorName: 'Mod One', gameSlug: undefined },
    });
  });

  it('writes through a supplied transaction client instead of the default', async () => {
    const defaultDb = makeDb();
    const tx = makeDb();
    const repository = new AuditLogRepository(
      defaultDb as unknown as PrismaService,
    );

    await repository.create(entry, tx as never);

    expect(tx.auditLog.create).toHaveBeenCalled();
    expect(defaultDb.auditLog.create).not.toHaveBeenCalled();
  });

  it('skips both lookups when the caller supplies the snapshots', async () => {
    const db = makeDb();
    const repository = new AuditLogRepository(db as unknown as PrismaService);

    await repository.create({
      ...entry,
      actorName: 'Passed Name',
      gameSlug: 'passed-slug',
    });

    expect(db.user.findUnique).not.toHaveBeenCalled();
    expect(db.game.findUnique).not.toHaveBeenCalled();
    expect(db.auditLog.create).toHaveBeenCalledWith({
      data: { ...entry, actorName: 'Passed Name', gameSlug: 'passed-slug' },
    });
  });
});
