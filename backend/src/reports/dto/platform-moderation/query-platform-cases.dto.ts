import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import {
  ModerationCaseStatus,
  ReportTargetType,
} from '../../../generated/prisma/client';

export class QueryPlatformCasesDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: ['all', 'platform', 'game'],
    default: 'all',
    description:
      'all: no game filter; platform: gameId is null, including deleted games; game: requires gameSlug.',
  })
  @IsOptional()
  @IsIn(['all', 'platform', 'game'])
  scope?: 'all' | 'platform' | 'game' = 'all';

  @ApiPropertyOptional({
    description: 'Required for scope=game; rejected for other scopes.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  gameSlug?: string;

  @ApiPropertyOptional({
    enum: ModerationCaseStatus,
    description: 'Native case status. Omit to include every status.',
  })
  @IsOptional()
  @IsEnum(ModerationCaseStatus)
  status?: ModerationCaseStatus;

  @ApiPropertyOptional({ enum: ReportTargetType })
  @IsOptional()
  @IsEnum(ReportTargetType)
  targetType?: ReportTargetType;
}
