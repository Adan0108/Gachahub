import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateCommentDto {
  @ApiProperty({
    example: 'This build is really useful.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  content!: string;
}
