import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  MaxLength,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

const EMOJI_MAX_LENGTH = 32;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

@ValidatorConstraint({ name: 'ExactlyOneReactionSelector', async: false })
class ExactlyOneReactionSelectorConstraint implements ValidatorConstraintInterface {
  validate(emoji: unknown, args: ValidationArguments): boolean {
    if (emoji !== undefined && emoji !== null && typeof emoji !== 'string') {
      return false;
    }

    const dto = args.object as ReactToMessageDto;
    const hasEmoji = isNonEmptyString(emoji);
    const hasEmoteId = isNonEmptyString(dto.emoteId);

    if (hasEmoji === hasEmoteId) {
      return false;
    }

    return !hasEmoji || emoji.length <= EMOJI_MAX_LENGTH;
  }

  defaultMessage(): string {
    return `Reaction requires exactly one of emoji (max ${EMOJI_MAX_LENGTH} chars) or emoteId`;
  }
}

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
  @Validate(ExactlyOneReactionSelectorConstraint)
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
