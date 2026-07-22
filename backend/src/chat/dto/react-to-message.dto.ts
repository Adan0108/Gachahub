import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { ChatMessageReactionType } from '../../generated/prisma/client';

/**
 * Request body for adding or changing a message reaction.
 *
 * Reaction types are fixed to a backend enum so clients cannot store arbitrary
 * reaction strings
 */
export class ReactToMessageDto {
  @ApiProperty({
    enum: ChatMessageReactionType,
    example: ChatMessageReactionType.LOVE,
  })
  @IsEnum(ChatMessageReactionType)
  type: ChatMessageReactionType;
}
