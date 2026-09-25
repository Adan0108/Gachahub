import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const PICKER_SELECT = { id: true, name: true, image: true } as const;

/** Active users the caller has no block with, in either direction. */
const pickableBy = (callerId: string) =>
  ({
    status: 'ACTIVE',
    // Hiding those who blocked the caller reveals a block by absence; accepted so blockers never see their target.
    blockedUsers: { none: { blockedId: callerId } },
    blockedBy: { none: { blockerId: callerId } },
  }) as const;

/** Prisma passes contains/startsWith values into ILIKE unescaped, so wildcards and the escape character are escaped here. */
export function escapeLikePattern(text: string): string {
  return text.replace(/[\\%_]/g, '\\$&');
}

@Injectable()
export class UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Active, non-blocked (either direction) users by name; backed by the pg_trgm index on user.name. */
  searchByName(
    callerId: string,
    q: string,
    match: 'prefix' | 'contains',
    limit: number,
  ) {
    const ci = { mode: 'insensitive' } as const;
    const literal = escapeLikePattern(q);
    const prefix = { startsWith: literal, ...ci };

    return this.prisma.user.findMany({
      where: {
        id: { not: callerId },
        ...pickableBy(callerId),
        ...(match === 'prefix'
          ? { name: prefix }
          : { name: { contains: literal, ...ci }, NOT: { name: prefix } }),
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: limit,
      select: PICKER_SELECT,
    });
  }

  /** Exact user id, so a pasted id finds its owner under the same rules as a name search. */
  findPickableById(callerId: string, id: string) {
    return this.prisma.user.findFirst({
      where: { id, NOT: { id: callerId }, ...pickableBy(callerId) },
      select: PICKER_SELECT,
    });
  }
}
