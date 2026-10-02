import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Length, Matches } from 'class-validator';

/** Letters, digits, `_` and `-` only, 3-20 chars - case-insensitive uniqueness (citext) keeps the casing the user picks. */
export const USERNAME_PATTERN = /^[A-Za-z0-9_-]{3,20}$/;

export class CompleteOnboardingDto {
  @ApiProperty({ description: 'Display name shown across the app.' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(2, 50)
  name: string;

  @ApiProperty({
    description:
      'Unique handle, 3-20 chars: letters, digits, "_" and "-" only.',
  })
  @IsString()
  @Matches(USERNAME_PATTERN, {
    message:
      'username must be 3-20 characters: letters, digits, "_" and "-" only',
  })
  username: string;
}
