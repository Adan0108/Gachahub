import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { MediaReferenceDto } from './media-reference.dto';

export class PostMediaReferenceDto extends MediaReferenceDto {
  @ApiPropertyOptional({
    example: 'Jinhsi build stats',
  })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  altText?: string;
}
