import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateLinkPreviewDto {
  @ApiProperty({
    description: 'A public http(s) link to preview.',
    example: 'https://example.com/article',
    maxLength: 2048,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  url!: string;
}
