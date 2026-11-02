import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { CosmeticSlot, Rarity } from '../../generated/prisma/client';

export class UpdateCosmeticDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  description?: string;

  @IsOptional()
  @IsEnum(CosmeticSlot)
  slot?: CosmeticSlot;

  @IsOptional()
  @IsEnum(Rarity)
  rarity?: Rarity;

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

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
