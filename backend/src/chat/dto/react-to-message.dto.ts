import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsOptional,
  IsString,
  MaxLength,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { isSingleEmoji } from '../../common/utils/is-single-emoji';

// Stray spaces around an emoji are dropped, so the presence check and the emoji check see the same value
const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

// Request-shape rules like "exactly one of these fields" live in the DTO, so they show in Swagger and 400 before the service runs
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
  @Transform(trimmed)
  @Validate(ExactlyOneReactionSelectorConstraint)
  emoji?: string;

  @ApiPropertyOptional({
    example: 'cm123emote456',
    description: 'Custom ChatEmote id used for image/gif emote reactions.',
  })
  @Transform(trimmed)
  @IsOptional()
  @IsString()
  @MaxLength(120)
  emoteId?: string;
}
