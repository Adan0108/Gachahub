import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class ConfirmMediaUploadDto {
  @ApiProperty({
    example: 'media_upload_database_id',
  })
  @IsString()
  uploadId!: string;

  @ApiProperty({
    example: 'cloudinary_asset_id',
  })
  @IsString()
  @MaxLength(255)
  assetId!: string;

  @ApiProperty({
    example: 'gachahub/post/user-id/generated-id',
  })
  @IsString()
  @MaxLength(500)
  publicId!: string;

  @ApiProperty({
    example:
      'https://res.cloudinary.com/demo/image/upload/v123/gachahub/post/user/file.webp',
  })
  @IsUrl({
    protocols: ['https'],
    require_protocol: true,
  })
  secureUrl!: string;

  @ApiProperty({
    example: 123456789,
  })
  @IsInt()
  @Min(1)
  version!: number;

  @ApiProperty({
    description: 'Signature returned by Cloudinary in the upload response',
  })
  @IsString()
  signature!: string;

  @ApiProperty({
    example: 'webp',
  })
  @IsString()
  @MaxLength(20)
  format!: string;

  @ApiProperty({
    example: 350000,
  })
  @IsInt()
  @Min(1)
  bytes!: number;

  @ApiPropertyOptional({
    example: 1200,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  width?: number;

  @ApiPropertyOptional({
    example: 900,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  height?: number;

  @ApiPropertyOptional({
    example: 13.5,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  duration?: number;
}
