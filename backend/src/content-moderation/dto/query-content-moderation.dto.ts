import { IsEnum, IsOptional } from 'class-validator';
import { ReportTargetType } from '../../generated/prisma/client';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class QueryContentModerationDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(ReportTargetType)
  type?: ReportTargetType;
}
