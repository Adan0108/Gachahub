import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  COMMUNITY_HISTORY_DEFAULT_LIMIT,
  COMMUNITY_HISTORY_MAX_LIMIT,
} from '../community-chat.constants';

export class QueryCommunityMessagesDto {
  @ApiPropertyOptional({
    description:
      'Return messages older than this message id. Omit for the newest page.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  before?: string;

  @ApiPropertyOptional({
    default: COMMUNITY_HISTORY_DEFAULT_LIMIT,
    maximum: COMMUNITY_HISTORY_MAX_LIMIT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(COMMUNITY_HISTORY_MAX_LIMIT)
  limit: number = COMMUNITY_HISTORY_DEFAULT_LIMIT;
}
