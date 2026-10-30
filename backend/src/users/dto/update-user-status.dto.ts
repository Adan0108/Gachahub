import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

/** Legacy status records are retained; new restrictions use expiring case sanctions. */
export const ADMIN_SETTABLE_USER_STATUSES = ['ACTIVE'] as const;

export class UpdateUserStatusDto {
  @IsIn(ADMIN_SETTABLE_USER_STATUSES)
  status!: (typeof ADMIN_SETTABLE_USER_STATUSES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
