import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { CosmeticSlot, Rarity } from '../../generated/prisma/client';

export class CreateCosmeticDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'slug must be lowercase kebab-case',
  })
  slug!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  description?: string;

  @IsEnum(CosmeticSlot)
  slot!: CosmeticSlot;

  @IsEnum(Rarity)
  rarity!: Rarity;

  @IsOptional()
  @IsBoolean()
  animated?: boolean;

  @ValidateIf(
    (_, value) => value !== null && value !== undefined && value !== '',
  )
  @IsString()
  @MaxLength(512)
  // Shown to every viewer, so only full https URLs.
  @IsUrl({ protocols: ['https'], require_protocol: true })
  assetUrl?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  presetId?: string | null;
}
