import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { escapeLikePattern } from '../common/utils/like-pattern';
import type { Prisma, UserRole, UserStatus } from '../generated/prisma/client';

const PICKER_SELECT = { id: true, name: true, image: true } as const;

/** Active users the caller has no block with, in either direction. */
const pickableBy = (callerId: string) =>
  ({
    status: 'ACTIVE',
    blockedUsers: { none: { blockedId: callerId } },
    blockedBy: { none: { blockerId: callerId } },
  }) as const;

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

  findForModeration(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      select: { id: true, name: true, email: true, role: true, status: true },
    });
  }

  async findManyForAdmin(params: {
    status?: UserStatus;
    role?: UserRole;
    search?: string;
    page: number;
    limit: number;
  }) {
    const { status, role, search, page, limit } = params;

    const where: Prisma.UserWhereInput = {
      ...(status ? { status } : {}),
      ...(role ? { role } : {}),
      ...(search
        ? {
            OR: [
              {
                name: {
                  contains: escapeLikePattern(search),
                  mode: 'insensitive',
                },
              },
              {
                email: {
                  contains: escapeLikePattern(search),
                  mode: 'insensitive',
                },
              },
            ],
          }
        : {}),
    };

    const skip = (page - 1) * limit;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          status: true,
          createdAt: true,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take: limit,
      }),
      this.prisma.user.count({ where }),
    ]);

    return { items, total };
  }

  /** Conditional on the expected current status, so two concurrent moderation actions on the same account can't silently clobber each other. Returns null if it no longer matches. Runs in the caller's transaction so the audit entry commits or rolls back with it. */
  async updateStatus(
    tx: Prisma.TransactionClient,
    id: string,
    fromStatus: UserStatus,
    toStatus: UserStatus,
  ) {
    const result = await tx.user.updateMany({
      where: { id, status: fromStatus },
      data: { status: toStatus },
    });

    if (result.count === 0) {
      return null;
    }

    return tx.user.findUniqueOrThrow({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true,
        createdAt: true,
      },
    });
  }
}
