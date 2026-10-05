import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Length, Matches } from 'class-validator';

/**
 * NOTE: frontend/lib/username.js holds a copy of this pattern and hint - change both together.
 * Letters, digits, `_` and `-`, 3-20 chars - case-insensitive uniqueness (citext) keeps the
 * casing the user picks. Must start and end with a letter or digit, and never two separators
 * in a row (`(?!.*[_-]{2,})`) - an explicit call, not an accident: `-bob`, `bob-`, `---` and
 * `a--b` are all rejected, matching Discord/GitHub's own handle rules.
 */
export const USERNAME_PATTERN =
  /^(?=.{3,20}$)[A-Za-z0-9](?!.*[_-]{2,})[A-Za-z0-9_-]*[A-Za-z0-9]$/;
export const USERNAME_HINT =
  '3-20 characters: letters, digits, "_" and "-", starting and ending with a letter or digit, and never two separators in a row.';

export class CompleteOnboardingDto {
  @ApiProperty({ description: 'Display name shown across the app.' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(2, 50)
  name: string;

  @ApiProperty({ description: USERNAME_HINT })
  @IsString()
  @Matches(USERNAME_PATTERN, { message: `username must be ${USERNAME_HINT}` })
  username: string;
}
