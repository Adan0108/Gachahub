import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { AuditAction, AuditTargetType } from '../../generated/prisma/client';

export class QueryAuditLogsDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(AuditAction)
  action?: AuditAction;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  actorId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  actorName?: string;

  @IsOptional()
  @IsEnum(AuditTargetType)
  targetType?: AuditTargetType;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  targetId?: string;
}
