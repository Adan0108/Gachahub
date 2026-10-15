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
import { isSingleEmoji } from '../utils/is-single-emoji';

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

    return !hasEmoji || isSingleEmoji(emoji);
  }

  defaultMessage(): string {
    return 'Reaction requires exactly one of a single emoji or emoteId';
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
    description:
      'One Unicode emoji, such as 😋, 🔟, 🇻🇳 or 👵🏽. Anything that is not a single emoji is refused.',
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
