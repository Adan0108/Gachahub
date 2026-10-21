import type { Prisma } from '../../generated/prisma/client';
import { escapeLikePattern } from '../utils/like-pattern';

const candidateSelect = {
  id: true,
  name: true,
  username: true,
  image: true,
  role: true,
} as const;

/** At most three bounded indexed/prefix reads. Short queries resolve only exact
 * handles; no similarity/substring search and no email/account metadata. */
export async function searchModeratorCandidates(
  db: Prisma.TransactionClient,
  eligibility: Prisma.UserWhereInput,
  value: string,
) {
  const query = value.trim().replace(/^@/, '').toLowerCase();
  if (!query || query.length > 100) return [];
  const exact = await db.user.findMany({
    where: { AND: [eligibility, { username: query }] },
    select: candidateSelect,
    take: 1,
  });
  if (query.length < 4) return exact;
  const prefix = {
    startsWith: escapeLikePattern(query),
    mode: 'insensitive' as const,
  };
  const handles = await db.user.findMany({
    where: {
      AND: [eligibility, { username: prefix }, { NOT: { username: query } }],
    },
    orderBy: [{ username: 'asc' }, { id: 'asc' }],
    select: candidateSelect,
    take: 10 - exact.length,
  });
  const results = [...exact, ...handles];
  if (results.length === 10) return results;
  const names = await db.user.findMany({
    where: {
      AND: [
        eligibility,
        { name: prefix },
        { OR: [{ username: null }, { NOT: { username: prefix } }] },
      ],
    },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    select: candidateSelect,
    take: 10 - results.length,
  });
  return [...results, ...names];
}
