import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { ChatMessageReactionType } from '../../generated/prisma/client';

export class ReactToMessageDto {
  @ApiProperty({
    enum: ChatMessageReactionType,
    example: ChatMessageReactionType.LOVE,
  })
  @IsEnum(ChatMessageReactionType)
  type: ChatMessageReactionType;
}
