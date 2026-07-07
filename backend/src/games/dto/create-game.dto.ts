import {
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

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
  @ApiProperty({
    example: 'Wuthering Waves',
    description: 'Official game community name.',
  })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional({
    example: 'wuthering-waves',
    description: `Optional custom slug. If not provided, it is generated from name.`,
  })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  slug?: string;

  @ApiPropertyOptional({
    example: 'Community for Wuthering Waves players.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({
    example: 'https://example.com/wuwa-icon.png',
  })
  @IsOptional()
  @IsUrl()
  iconUrl?: string;

  @ApiPropertyOptional({
    example: 'https://example.com/wuwa-banner.png',
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
}
