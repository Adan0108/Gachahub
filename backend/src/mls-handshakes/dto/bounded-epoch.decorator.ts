import { applyDecorators } from '@nestjs/common';
import { IsInt, Max, Min } from 'class-validator';

/** Postgres Int4 ceiling: anything above would reach Prisma and fail as a 500. */
export const MAX_EPOCH = 2_147_483_647;

/** An MLS epoch: an integer the database column can hold. */
export function BoundedEpoch() {
  return applyDecorators(IsInt(), Min(0), Max(MAX_EPOCH));
}
