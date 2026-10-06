import { Prisma } from '../generated/prisma/client';

/** True for a Prisma unique-constraint violation (P2002) on the given field. */
export function isUniqueViolationOn(error: unknown, field: string): boolean {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== 'P2002'
  ) {
    return false;
  }

  const target = error.meta?.target;
  return Array.isArray(target)
    ? target.includes(field)
    : typeof target === 'string' && target.includes(field);
}
