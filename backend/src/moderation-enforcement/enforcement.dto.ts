import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import {
  AppealStatus,
  ReportReason,
  SanctionType,
  ViolationSeverity,
} from '../generated/prisma/client';

export class ScopeQuery {
  @IsOptional() @IsString() @MaxLength(100) contentCursor?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100) gameSlug?: string;
  @IsOptional() @IsString() @MaxLength(100) cursor?: string;
}
export class ReasonDto {
  @IsString() @MinLength(3) @MaxLength(1000) reason!: string;
}
export class ContentDecisionDto extends ReasonDto {
  @IsBoolean() hidden!: boolean;
}
export class ConfirmViolationDto extends ReasonDto {
  @IsEnum(ReportReason) category!: ReportReason;
  @IsEnum(ViolationSeverity) severity!: ViolationSeverity;
}
export class SanctionDto extends ReasonDto {
  @IsEnum(SanctionType) type!: SanctionType;
  @IsUUID() requestKey!: string;
  @ValidateIf(
    (object: SanctionDto, value: unknown) =>
      object.type !== SanctionType.WARNING || value !== undefined,
  )
  @IsInt()
  @Min(1)
  @Max(30)
  durationDays?: number;
  @IsOptional() @IsString() @MaxLength(100) violationId?: string;
  @IsOptional() @IsString() @MaxLength(100) enforcementId?: string;
}
export class AdjustSanctionDto extends ReasonDto {
  @IsInt() @Min(1) @Max(30) durationDays!: number;
}
export class AppealDto {
  @IsString() @MinLength(10) @MaxLength(2000) statement!: string;
}
export class ReviewAppealDto extends ReasonDto {
  @IsEnum({ ACCEPTED: AppealStatus.ACCEPTED, REJECTED: AppealStatus.REJECTED })
  decision!: 'ACCEPTED' | 'REJECTED';
  @IsOptional() @IsBoolean() reverseViolation?: boolean;
  @IsOptional() @IsBoolean() restoreContent?: boolean;
}
