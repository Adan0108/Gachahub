import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';
import { USERNAME_PATTERN } from './complete-onboarding.dto';

export class CheckUsernameQueryDto {
  @ApiProperty({ description: 'Handle to check, 3-20 chars.' })
  @IsString()
  @Matches(USERNAME_PATTERN, {
    message:
      'username must be 3-20 characters: letters, digits, "_" and "-" only',
  })
  username!: string;
}
