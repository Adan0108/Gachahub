import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { QueryModerationCasesDto } from '../query-moderation-cases.dto';

export class QueryPlatformCasesDto extends QueryModerationCasesDto {
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
}
