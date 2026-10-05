import {
  IsEnum,
  IsOptional,
  IsString,
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

// Status values the generic PATCH /games/:id route may set directly - ARCHIVED is excluded, that only happens through GameModerationService.archive/restore.
export enum UpdatableGameStatusDto {
  ACTIVE = 'ACTIVE',
  HIDDEN = 'HIDDEN',
}

// DTO used when updating a game community; branding (iconUrl/bannerUrl) is excluded, set only at creation or via GameModerationService.updateBranding.
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
    enum: UpdatableGameStatusDto,
    example: UpdatableGameStatusDto.ACTIVE,
  })
  @IsOptional()
  @IsEnum(UpdatableGameStatusDto)
  status?: UpdatableGameStatusDto;
}
