import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * DELETED is deliberately not a valid target here - that status belongs to
 * account deletion, a separate (and not yet built) flow, never something an
 * admin sets as a moderation action.
 */
export const ADMIN_SETTABLE_USER_STATUSES = [
  'ACTIVE',
  'SUSPENDED',
  'BANNED',
] as const;

export class UpdateUserStatusDto {
  @IsIn(ADMIN_SETTABLE_USER_STATUSES)
  status!: (typeof ADMIN_SETTABLE_USER_STATUSES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
