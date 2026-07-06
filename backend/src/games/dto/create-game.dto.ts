import {
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * DTO used when creating a new game community.
 *
 * A game is the root community in Gacha Hub.
 * Examples:
 * - Wuthering Waves
 * - Honkai Star Rail
 * - Genshin Impact
 *
 * Most other features such as posts, builds, teams, categories,
 * and moderators will be connected to a game.
 */
export class CreateGameDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

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
}
