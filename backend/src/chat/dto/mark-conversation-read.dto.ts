import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class MarkConversationReadDto {
  @ApiPropertyOptional({
    example: 'cm123message456',
    description:
      'Last message visible to the user. Omit to mark all current conversation messages as read.',
  })
  @IsOptional()
  @IsString()
  lastReadMessageId?: string;
}
