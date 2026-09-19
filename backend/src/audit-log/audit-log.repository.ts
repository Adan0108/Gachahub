import { Injectable } from '@nestjs/common';
import {
  Prisma,
  type AuditAction,
  type AuditTargetType,
} from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AuditEntry } from './audit-log.types';

const auditLogInclude = {
  actor: {
    select: { id: true, image: true },
  },
} satisfies Prisma.AuditLogInclude;

@Injectable()
export class AuditLogRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Stores the actor's name and the game's slug alongside the ids, so the
   * entry stays readable if either row is later deleted (both FKs are SetNull).
   * Callers pass what they already hold; only missing values cost a lookup.
   * Pass a transaction client to write atomically with the audited change.
   */
  async create(entry: AuditEntry, db: Prisma.TransactionClient = this.prisma) {
    const [actorName, gameSlug] = await Promise.all([
      entry.actorName ?? this.findActorName(db, entry.actorId),
      entry.gameSlug ?? this.findGameSlug(db, entry.gameId),
    ]);

    return db.auditLog.create({
      data: { ...entry, actorName, gameSlug },
    });
  }

  private async findActorName(db: Prisma.TransactionClient, actorId: string) {
    const actor = await db.user.findUnique({
      where: { id: actorId },
      select: { name: true },
    });

    return actor?.name;
  }

  private async findGameSlug(
    db: Prisma.TransactionClient,
    gameId: string | undefined,
  ) {
    if (!gameId) return undefined;

    const game = await db.game.findUnique({
      where: { id: gameId },
      select: { slug: true },
    });

    return game?.slug;
  }

  async findMany(params: {
    gameId?: string;
    action?: AuditAction;
    actorId?: string;
    actorName?: string;
    targetType?: AuditTargetType;
    targetId?: string;
    page: number;
    limit: number;
  }) {
    const where: Prisma.AuditLogWhereInput = {
      ...(params.gameId ? { gameId: params.gameId } : {}),
      ...(params.action ? { action: params.action } : {}),
      ...(params.actorId ? { actorId: params.actorId } : {}),
      ...(params.actorName
        ? {
            actorName: {
              contains: params.actorName,
              mode: 'insensitive' as const,
            },
          }
        : {}),
      ...(params.targetType ? { targetType: params.targetType } : {}),
      ...(params.targetId ? { targetId: params.targetId } : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        include: auditLogInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (params.page - 1) * params.limit,
        take: params.limit,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { items, total };
  }
}
