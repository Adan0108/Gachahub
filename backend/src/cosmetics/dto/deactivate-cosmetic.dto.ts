import { IsOptional, IsString, MaxLength } from 'class-validator';

export class DeactivateCosmeticDto {
  @IsOptional()
  @IsString()
  @MaxLength(240)
  reason?: string;
}

export class GrantCosmeticDto {
  @IsString()
  @MaxLength(128)
  itemId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  reason?: string;
}
