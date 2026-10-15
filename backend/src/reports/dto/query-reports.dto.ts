import { IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { ReportTargetType } from '../../generated/prisma/client';
import { LegacyReportStatus } from '../report-status.compat';

export class QueryReportsDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(LegacyReportStatus)
  status?: LegacyReportStatus;

  @IsOptional()
  @IsEnum(ReportTargetType)
  targetType?: ReportTargetType;
}
