import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';
import { USERNAME_HINT, USERNAME_PATTERN } from './complete-onboarding.dto';

export class CheckUsernameQueryDto {
  @ApiProperty({ description: 'Handle to check, 3-20 chars.' })
  @IsString()
  @Matches(USERNAME_PATTERN, { message: `username must be ${USERNAME_HINT}` })
  username!: string;
}
