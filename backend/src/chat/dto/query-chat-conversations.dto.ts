import { Type } from 'class-transformer';
import {
  IsDefined,
  IsISO8601,
  IsInt,
  IsString,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

type InboxQuery = {
  limit?: number;
  beforeUpdatedAt?: string;
  beforeId?: string;
};

const hasCursor = (query: InboxQuery) =>
  query.beforeUpdatedAt !== undefined || query.beforeId !== undefined;
const CURSOR_PAIR = 'beforeUpdatedAt and beforeId must be sent together';

/**
 * Query params for one page of the inbox.
 *
 * Without `limit` the whole inbox comes back, as before. With it, the first page is every pinned
 * conversation plus the `limit` most recently active others; each later page continues after the
 * last unpinned conversation the client has, by (updatedAt, id), newest first.
 */
export class QueryChatConversationsDto {
  @ApiPropertyOptional({ example: 50, minimum: 1, maximum: 100 })
  @ValidateIf(
    (query: InboxQuery) => query.limit !== undefined || hasCursor(query),
  )
  @IsDefined({ message: 'A cursor needs a limit' })
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
  @ValidateIf(hasCursor)
  @IsDefined({ message: CURSOR_PAIR })
  @IsISO8601()
  beforeUpdatedAt?: string;

  @ApiPropertyOptional({
    example: 'cm123conversation456',
    description: 'id of that same conversation, breaking ties on updatedAt.',
  })
  @ValidateIf(hasCursor)
  @IsDefined({ message: CURSOR_PAIR })
  @IsString()
  beforeId?: string;
}
