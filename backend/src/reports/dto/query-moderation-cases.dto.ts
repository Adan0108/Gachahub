import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import {
  ModerationCaseStatus,
  ReportTargetType,
} from '../../generated/prisma/client';

export class QueryModerationCasesDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: ModerationCaseStatus,
    description: 'Native workflow status; omit for all statuses.',
  })
  @IsOptional()
  @IsEnum(ModerationCaseStatus)
  status?: ModerationCaseStatus;

  @ApiPropertyOptional({ enum: ReportTargetType })
  @IsOptional()
  @IsEnum(ReportTargetType)
  targetType?: ReportTargetType;
}
