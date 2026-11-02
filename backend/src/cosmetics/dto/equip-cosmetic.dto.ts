import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { CosmeticSlot } from '../../generated/prisma/client';

export class EquipCosmeticDto {
  @IsEnum(CosmeticSlot)
  slot!: CosmeticSlot;

  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(128)
  itemId!: string | null;
}

export class EquipCosmeticsBatchDto {
  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsString()
  @MaxLength(128)
  frame?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsString()
  @MaxLength(128)
  profileBackground?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsString()
  @MaxLength(128)
  miniBackground?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsString()
  @MaxLength(128)
  banner?: string | null;
}
