import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Request body for marking conversation messages as read
 *
 * When lastReadMessageId omitted, the backend marks all-
 * -current conversation messages as read for the caller
 */
export class MarkConversationReadDto {
  @ApiPropertyOptional({
    example: 'cm123message456',
    description:
      'Last message visible to the user. Omit to mark all current conversation messages as read.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  lastReadMessageId?: string;
}
