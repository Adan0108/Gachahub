import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class PendingWelcomesQueryDto {
  @ApiPropertyOptional({
    description:
      'Welcome id of the last one already seen; returns the ones created after it',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  after?: string;
}
