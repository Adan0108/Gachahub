import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';

/**
 * Shared shape for referencing an already-uploaded, unattached media upload.
 * Post/comment/chat-specific reference DTOs extend this instead of
 * redeclaring mediaUploadId/sortOrder each time.
 */
export class MediaReferenceDto {
  @ApiProperty({
    example: 'media_upload_database_id',
  })
  @IsString()
  mediaUploadId!: string;

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
