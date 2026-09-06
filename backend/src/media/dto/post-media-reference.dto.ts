import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class PostMediaReferenceDto {
  @ApiProperty({
    example: 'media_upload_database_id',
  })
  @IsString()
  mediaUploadId!: string;

  @ApiPropertyOptional({
    example: 'Jinhsi build stats',
  })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  altText?: string;

  @ApiPropertyOptional({
    example: 0,
    default: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
