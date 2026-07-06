import {
  IsEnum,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
} from 'class-validator';

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
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  slug?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsUrl()
  iconUrl?: string;

  @IsOptional()
  @IsUrl()
  bannerUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  developer?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  publisher?: string;

  @IsOptional()
  @IsEnum(GameStatusDto)
  status?: GameStatusDto;
}
