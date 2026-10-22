import type { Prisma } from '../../generated/prisma/client';
import { escapeLikePattern } from '../utils/like-pattern';

const candidateSelect = {
  id: true,
  name: true,
  username: true,
  image: true,
  role: true,
} as const;

/** @handles are exact only; bare text also allows bounded display-name prefixes. */
export async function searchModeratorCandidates(
  db: Prisma.TransactionClient,
  eligibility: Prisma.UserWhereInput,
  value: string,
) {
  const handleOnly = value.trim().startsWith('@');
  const query = value.trim().replace(/^@/, '').toLowerCase();
  if (!query || query.length > 100) return [];
  const exact = await db.user.findMany({
    where: { AND: [eligibility, { username: query }] },
    select: candidateSelect,
    take: 1,
  });
  if (handleOnly || query.length < 4) return exact;
  const prefix = {
    startsWith: escapeLikePattern(query),
    mode: 'insensitive' as const,
  };
  const results = exact;
  const names = await db.user.findMany({
    where: {
      AND: [
        eligibility,
        { name: prefix },
        { id: { notIn: exact.map((user) => user.id) } },
      ],
    },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    select: candidateSelect,
    take: 10 - results.length,
  });
  return [...results, ...names];
}
