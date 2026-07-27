import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Request body for adding or changing a message reaction.
 *
 * Use emoji for normal Unicode emoji from a keyboard. Use emoteId for custom
 * image/gif emotes stored in ChatEmote.
 */
export class ReactToMessageDto {
  @ApiPropertyOptional({
    example: '😋',
    description: 'Raw Unicode emoji reaction, such as 😋, 🔟, or 👵🏽.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  emoji?: string;

  @ApiPropertyOptional({
    example: 'cm123emote456',
    description: 'Custom ChatEmote id used for image/gif emote reactions.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  emoteId?: string;
}
