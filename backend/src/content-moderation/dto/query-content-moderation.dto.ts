import { IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';
import { ReportTargetType } from '../../generated/prisma/client';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class QueryContentModerationDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(ReportTargetType)
  type?: ReportTargetType;

  // Opt-in: /admin/content itself still needs to see HIDDEN items (to restore them); only a "what still needs attention" view should exclude them.
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  excludeHidden?: boolean;
}
