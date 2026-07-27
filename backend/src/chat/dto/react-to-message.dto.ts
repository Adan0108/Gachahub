import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

/**
 * Request body for adding or changing a message reaction.
 *
 * Reactions point to ChatEmote so global unicode emotes and custom game emotes
 * can share the same reaction system.
 */
export class ReactToMessageDto {
  @ApiProperty({
    example: 'cm123emote456',
    description: 'Emote id used for this message reaction.',
  })
  @IsString()
  @MaxLength(120)
  emoteId!: string;
}
