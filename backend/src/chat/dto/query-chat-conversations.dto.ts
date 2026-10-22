import { Type } from 'class-transformer';
import {
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Query params for one page of the inbox.
 *
 * Without `limit` the whole inbox comes back, as before. With it, the first page is every pinned
 * conversation plus the `limit` most recently active others; each later page continues after the
 * last unpinned conversation the client has, by (updatedAt, id), newest first.
 */
export class QueryChatConversationsDto {
  @ApiPropertyOptional({ example: 50, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({
    example: '2026-10-22T10:00:00.000Z',
    description:
      'updatedAt of the last unpinned conversation already loaded; send with beforeId.',
  })
  @IsOptional()
  @IsISO8601()
  beforeUpdatedAt?: string;

  @ApiPropertyOptional({
    example: 'cm123conversation456',
    description: 'id of that same conversation, breaking ties on updatedAt.',
  })
  @IsOptional()
  @IsString()
  beforeId?: string;
}
