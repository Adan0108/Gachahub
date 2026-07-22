import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Query params for loading convo history.
 *
 * API uses cursor pagination instead of page numbers because chat history is-
 * -appemd-only and users normally load older messages from a known message id.
 */
export class QueryChatMessagesDto {
  @ApiPropertyOptional({
    example: 'cm123message456',
    description:
      'Return messages created before this message id. Omit for newest page.',
  })
  @IsOptional()
  @IsString()
  beforeMessageId?: string;

  @ApiPropertyOptional({
    example: 30,
    default: 30,
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 30;
}
