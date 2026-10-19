import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { QueryReportsDto } from './query-reports.dto';

export class QueryPlatformReportsDto extends QueryReportsDto {
  @ApiPropertyOptional({
    enum: ['all', 'platform', 'game'],
    default: 'all',
    description:
      'all: every report; platform: case.gameId is null; game: gameSlug required.',
  })
  @IsOptional()
  @IsIn(['all', 'platform', 'game'])
  scope?: 'all' | 'platform' | 'game' = 'all';

  @ApiPropertyOptional({
    description: 'Required only for scope=game; rejected for other scopes.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  gameSlug?: string;
}
