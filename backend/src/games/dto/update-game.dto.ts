import {
  IsEnum,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Game status values used by the API layer.
 *
 * This enum mirrors the Prisma GameStatus enum.
 * Keeping it here avoids tightly coupling request validation to Prisma internals.
 */
export enum GameStatusDto {
  ACTIVE = 'ACTIVE',
  ARCHIVED = 'ARCHIVED',
  HIDDEN = 'HIDDEN',
}

/**
 * DTO used when updating a game community.
 *
 * All fields are optional because PATCH requests only update
 * the fields that the client sends.
 */
export class UpdateGameDto {
  @ApiPropertyOptional({
    example: 'Wuthering Waves',
  })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({
    example: 'wuthering-waves',
  })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  slug?: string;

  @ApiPropertyOptional({
    example: 'Updated game community description.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({
    example: 'https://example.com/icon.png',
  })
  @IsOptional()
  @IsUrl()
  iconUrl?: string;

  @ApiPropertyOptional({
    example: 'https://example.com/banner.png',
  })
  @IsOptional()
  @IsUrl()
  bannerUrl?: string;

  @ApiPropertyOptional({
    example: 'Kuro Games',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  developer?: string;

  @ApiPropertyOptional({
    example: 'Kuro Games',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  publisher?: string;

  @ApiPropertyOptional({
    enum: GameStatusDto,
    example: GameStatusDto.ACTIVE,
  })
  @IsOptional()
  @IsEnum(GameStatusDto)
  status?: GameStatusDto;
}
