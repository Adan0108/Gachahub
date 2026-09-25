import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const PICKER_SELECT = { id: true, name: true, image: true } as const;

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
        status: 'ACTIVE',
        ...(match === 'prefix'
          ? { name: prefix }
          : { name: { contains: literal, ...ci }, NOT: { name: prefix } }),
        // Hiding those who blocked the caller reveals a block by absence; accepted so blockers never see their target.
        blockedUsers: { none: { blockedId: callerId } },
        blockedBy: { none: { blockerId: callerId } },
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: limit,
      select: PICKER_SELECT,
    });
  }
}
