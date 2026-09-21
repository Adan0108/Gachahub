import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class CreateDevTestUserDto {
  @ApiPropertyOptional({
    description:
      'Optional label folded into the generated name/email, e.g. "Bob" - purely for telling test users apart in the list, not an identifier.',
    example: 'Bob',
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  @Matches(/^[A-Za-z0-9 _-]*$/, {
    message: 'label may only contain letters, numbers, spaces, _ and -',
  })
  label?: string;
}
