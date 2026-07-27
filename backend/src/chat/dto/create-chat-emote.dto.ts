import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Request body for creating a custom game emote.
 *
 * File processing is handled before this request for now. The backend stores
 * the final image/gif URLs and metadata used by chat reactions/messages.
 */
export class CreateChatEmoteDto {
  @ApiProperty({
    example: 'catcooking',
  })
  @IsString()
  @MaxLength(80)
  shortcode!: string;

  @ApiPropertyOptional({
    example: '\\u{1F639}',
  })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  unicode?: string;

  @ApiPropertyOptional({
    example: 'https://cdn.gachahub.com/emotes/catcooking.png',
  })
  @IsOptional()
  @IsUrl()
  imageUrl?: string;

  @ApiPropertyOptional({
    example: 'https://cdn.gachahub.com/emotes/catcooking.gif',
  })
  @IsOptional()
  @IsUrl()
  animationUrl?: string;

  @ApiPropertyOptional({ example: 200 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(512)
  width?: number;

  @ApiPropertyOptional({ example: 200 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(512)
  height?: number;

  @ApiPropertyOptional({ example: 250000 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1024 * 1024)
  fileSize?: number;

  @ApiPropertyOptional({ example: 'image/gif' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  mimeType?: string;
}
